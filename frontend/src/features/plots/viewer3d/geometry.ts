/**
 * Pure geometry for the 3D viewer (no three.js dependency, unit-tested).
 *
 * Coordinates are re-origined to the data centre in float64 before being cast
 * to float32 for the GPU: at UTM northings (~7,300,000 m) float32 has a 0.5 m
 * step, which makes point clouds visibly jitter and collapse onto a grid.
 */

export interface Bounds3 {
    min: [number, number, number];
    max: [number, number, number];
}

export interface PointCloudGeometry {
    /** Local (re-origined) xyz, float32, 3 per point; NaN rows are flagged invalid */
    positions: Float32Array;
    /** 1 = has finite x, y and z */
    valid: Uint8Array;
    /** World coordinate of local (0,0,0) */
    origin: [number, number, number];
    /** Bounds in LOCAL coordinates over valid points */
    bounds: Bounds3;
    validCount: number;
}

/**
 * Build GPU positions from world coordinate columns. `z` may be null (flat
 * plan view at z = 0). The origin is the centre of the valid points' bounds.
 */
export function buildPointCloud(
    x: ArrayLike<number>,
    y: ArrayLike<number>,
    z: ArrayLike<number> | null,
): PointCloudGeometry {
    const n = x.length;
    const valid = new Uint8Array(n);
    const wmin: [number, number, number] = [Infinity, Infinity, Infinity];
    const wmax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let validCount = 0;
    for (let i = 0; i < n; i++) {
        const xi = x[i], yi = y[i], zi = z ? z[i] : 0;
        if (!Number.isFinite(xi) || !Number.isFinite(yi) || !Number.isFinite(zi)) continue;
        valid[i] = 1;
        validCount++;
        if (xi < wmin[0]) wmin[0] = xi; if (xi > wmax[0]) wmax[0] = xi;
        if (yi < wmin[1]) wmin[1] = yi; if (yi > wmax[1]) wmax[1] = yi;
        if (zi < wmin[2]) wmin[2] = zi; if (zi > wmax[2]) wmax[2] = zi;
    }
    const origin: [number, number, number] = validCount > 0
        ? [(wmin[0] + wmax[0]) / 2, (wmin[1] + wmax[1]) / 2, (wmin[2] + wmax[2]) / 2]
        : [0, 0, 0];
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        if (!valid[i]) {
            positions[i * 3] = positions[i * 3 + 1] = positions[i * 3 + 2] = 0;
            continue;
        }
        // Subtract in float64 first, then store as float32
        positions[i * 3] = x[i] - origin[0];
        positions[i * 3 + 1] = y[i] - origin[1];
        positions[i * 3 + 2] = (z ? z[i] : 0) - origin[2];
    }
    const bounds: Bounds3 = validCount > 0
        ? {
            min: [wmin[0] - origin[0], wmin[1] - origin[1], wmin[2] - origin[2]],
            max: [wmax[0] - origin[0], wmax[1] - origin[1], wmax[2] - origin[2]],
        }
        : { min: [0, 0, 0], max: [0, 0, 0] };
    return { positions, valid, origin, bounds, validCount };
}

// ---------------------------------------------------------------------------
// Clip box and section slab (same tests as the shader, for selection)
// ---------------------------------------------------------------------------

export interface ClipState {
    boxEnabled: boolean;
    /** Local coordinates (vertical exaggeration NOT applied) */
    boxMin: [number, number, number];
    boxMax: [number, number, number];
    slabEnabled: boolean;
    /** Unit normal of the section plane */
    slabNormal: [number, number, number];
    /** Point on the plane (local coordinates) */
    slabCenter: [number, number, number];
    /** Half thickness in metres */
    slabHalfWidth: number;
}

/**
 * Section-plane normal from geological orientation: `azimuth` is the strike
 * of the section line in degrees clockwise from north (the plane contains
 * that horizontal direction), `dip` is the plane's dip in degrees (90 =
 * vertical section, 0 = horizontal level plan).
 */
export function sectionNormal(azimuthDeg: number, dipDeg: number): [number, number, number] {
    const az = (azimuthDeg * Math.PI) / 180;
    const dip = (dipDeg * Math.PI) / 180;
    // Horizontal direction perpendicular to the strike (pointing to strike + 90°)
    const hx = Math.sin(az + Math.PI / 2);
    const hy = Math.cos(az + Math.PI / 2);
    // Tilt from vertical (dip 90 -> horizontal normal; dip 0 -> vertical normal)
    const s = Math.sin(dip);
    const c = Math.cos(dip);
    return [hx * s, hy * s, c];
}

export function isInsideClip(px: number, py: number, pz: number, clip: ClipState): boolean {
    if (clip.boxEnabled) {
        if (px < clip.boxMin[0] || px > clip.boxMax[0]) return false;
        if (py < clip.boxMin[1] || py > clip.boxMax[1]) return false;
        if (pz < clip.boxMin[2] || pz > clip.boxMax[2]) return false;
    }
    if (clip.slabEnabled) {
        const d = (px - clip.slabCenter[0]) * clip.slabNormal[0]
            + (py - clip.slabCenter[1]) * clip.slabNormal[1]
            + (pz - clip.slabCenter[2]) * clip.slabNormal[2];
        if (Math.abs(d) > clip.slabHalfWidth) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Screen-space selection
// ---------------------------------------------------------------------------

/**
 * Project local positions to CSS pixel coordinates with a column-major 4x4
 * model-view-projection matrix (three.js `elements` order). Points behind the
 * camera or outside clip space get NaN.
 */
export function projectToScreen(
    positions: Float32Array,
    mvp: ArrayLike<number>,
    width: number,
    height: number,
    out?: Float32Array,
): Float32Array {
    const n = positions.length / 3;
    const screen = out ?? new Float32Array(n * 2);
    const m = mvp;
    for (let i = 0; i < n; i++) {
        const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
        const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (cw <= 0 || cz < -cw || cz > cw) {
            screen[i * 2] = NaN;
            screen[i * 2 + 1] = NaN;
            continue;
        }
        screen[i * 2] = ((cx / cw) * 0.5 + 0.5) * width;
        screen[i * 2 + 1] = (1 - ((cy / cw) * 0.5 + 0.5)) * height;
    }
    return screen;
}

/** Even-odd point-in-polygon test; polygon is a flat [x0, y0, x1, y1, ...] list. */
export function pointInPolygon(px: number, py: number, poly: ArrayLike<number>): boolean {
    let inside = false;
    const n = poly.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i * 2], yi = poly[i * 2 + 1];
        const xj = poly[j * 2], yj = poly[j * 2 + 1];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/**
 * Indices of points whose screen projection falls inside `poly`, restricted
 * to `eligible` points (valid, visible and not clipped — what the user sees).
 */
export function selectInPolygon(
    screen: Float32Array,
    poly: ArrayLike<number>,
    eligible: (i: number) => boolean,
): number[] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < poly.length; k += 2) {
        minX = Math.min(minX, poly[k]); maxX = Math.max(maxX, poly[k]);
        minY = Math.min(minY, poly[k + 1]); maxY = Math.max(maxY, poly[k + 1]);
    }
    const out: number[] = [];
    const n = screen.length / 2;
    for (let i = 0; i < n; i++) {
        const sx = screen[i * 2], sy = screen[i * 2 + 1];
        if (!(sx >= minX && sx <= maxX && sy >= minY && sy <= maxY)) continue; // also rejects NaN
        if (!eligible(i)) continue;
        if (pointInPolygon(sx, sy, poly)) out.push(i);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** Parse '#rgb', '#rrggbb', '#rrggbbaa', 'rgb(...)' or 'rgba(...)' into 0-1 floats. */
export function parseCssColor(css: string): [number, number, number, number] {
    const s = css.trim();
    if (s.startsWith('#')) {
        let hex = s.slice(1);
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return [r, g, b, a];
    }
    const m = /rgba?\(([^)]+)\)/i.exec(s);
    if (m) {
        const parts = m[1].split(',').map(p => parseFloat(p.trim()));
        return [parts[0] / 255, parts[1] / 255, parts[2] / 255, parts.length > 3 ? parts[3] : 1];
    }
    return [0.5, 0.5, 0.5, 1];
}

/** "Nice" tick values covering [min, max] with roughly `count` ticks. */
export function niceTicks(min: number, max: number, count = 5): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
    const raw = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const ticks: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
}
