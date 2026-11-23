/**
 * Topography from a GeoTIFF (Phase 229; pure): the part of the format that
 * files of heights use, read to the same grid of heights as the other
 * topography files (features/model/topoFiles).
 *
 * Read: one band of whole numbers (8, 16 or 32 bits) or of floats (32 or 64
 * bits); in strips or in tiles; not packed, or packed with LZW, Deflate or
 * PackBits, with or without a predictor; classic TIFF and BigTIFF, either
 * byte order; placed by ModelPixelScale and ModelTiepoint, or by a
 * ModelTransformation that does not turn it; GDAL's no-data value.
 *
 * Not read, and said in a sentence: pictures (several bands), JPEG and the
 * rarer packings, a grid that is turned, a file that does not say where it
 * is, and a grid in degrees (it has to be in metres, in the drilling's grid).
 */
import { MOST_CELLS, NotTopography, type HeightGrid } from './topoFiles';

const TAG = {
    width: 256, height: 257, bits: 258, compression: 259, stripOffsets: 273, samples: 277, rowsPerStrip: 278, stripCounts: 279,
    planar: 284, predictor: 317, tileWidth: 322, tileHeight: 323, tileOffsets: 324, tileCounts: 325, format: 339,
    pixelScale: 33550, tiepoint: 33922, transformation: 34264, geoKeys: 34735, noData: 42113,
} as const;

/** Bytes a value of each TIFF type takes (types 1-13, 16-18) */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

interface Entry { type: number; count: number; at: number }

/** The first directory of a TIFF: where each tag's values are */
function directory(view: DataView): { entries: Map<number, Entry>; little: boolean } {
    if (view.byteLength < 16) throw new NotTopography('This is not a TIFF file.');
    const order = view.getUint16(0);
    if (order !== 0x4949 && order !== 0x4d4d) throw new NotTopography('This is not a TIFF file.');
    const little = order === 0x4949;
    const magic = view.getUint16(2, little);
    if (magic !== 42 && magic !== 43) throw new NotTopography('This is not a TIFF file.');
    const big = magic === 43;
    const offset = (at: number) => (big ? Number(view.getBigUint64(at, little)) : view.getUint32(at, little));
    const first = offset(big ? 8 : 4);
    const count = big ? Number(view.getBigUint64(first, little)) : view.getUint16(first, little);
    const entries = new Map<number, Entry>();
    const size = big ? 20 : 12, start = first + (big ? 8 : 2), inline = big ? 8 : 4;
    if (start + count * size > view.byteLength) throw new NotTopography('The TIFF file is cut short.');
    for (let k = 0; k < count; k++) {
        const at = start + k * size;
        const tag = view.getUint16(at, little), type = view.getUint16(at + 2, little);
        const n = big ? Number(view.getBigUint64(at + 4, little)) : view.getUint32(at + 4, little);
        const bytes = n * (TYPE_SIZE[type] ?? 1);
        const where = at + (big ? 12 : 8);
        entries.set(tag, { type, count: n, at: bytes <= inline ? where : offset(where) });
    }
    return { entries, little };
}

/** A tag's values as numbers (none: an empty list) */
function numbers(view: DataView, little: boolean, e: Entry | undefined): number[] {
    if (!e) return [];
    const size = TYPE_SIZE[e.type] ?? 1;
    if (e.at + e.count * size > view.byteLength) throw new NotTopography('The TIFF file is cut short.');
    const out: number[] = new Array(e.count);
    for (let k = 0; k < e.count; k++) {
        const at = e.at + k * size;
        switch (e.type) {
            case 1: case 2: case 7: out[k] = view.getUint8(at); break;
            case 6: out[k] = view.getInt8(at); break;
            case 3: out[k] = view.getUint16(at, little); break;
            case 8: out[k] = view.getInt16(at, little); break;
            case 4: case 13: out[k] = view.getUint32(at, little); break;
            case 9: out[k] = view.getInt32(at, little); break;
            case 11: out[k] = view.getFloat32(at, little); break;
            case 12: out[k] = view.getFloat64(at, little); break;
            case 16: case 18: out[k] = Number(view.getBigUint64(at, little)); break;
            case 17: out[k] = Number(view.getBigInt64(at, little)); break;
            case 5: out[k] = view.getUint32(at, little) / view.getUint32(at + 4, little); break;
            case 10: out[k] = view.getInt32(at, little) / view.getInt32(at + 4, little); break;
            default: out[k] = NaN;
        }
    }
    return out;
}

/** TIFF's LZW (codes of 9 to 12 bits, the most significant bit first), to `length` bytes */
export function unLzw(src: Uint8Array, length: number): Uint8Array {
    const out = new Uint8Array(length);
    const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), size = new Uint16Array(4096);
    for (let c = 0; c < 256; c++) { prefix[c] = -1; suffix[c] = c; first[c] = c; size[c] = 1; }
    let bits = 9, next = 258, prev = -1, buffer = 0, held = 0, ip = 0, op = 0;
    while (op < length) {
        while (held < bits) {
            if (ip >= src.length) return out;
            buffer = (buffer << 8) | src[ip++];
            held += 8;
        }
        const code = (buffer >>> (held - bits)) & ((1 << bits) - 1);
        held -= bits;
        buffer &= (1 << held) - 1;
        if (code === 257) break;
        if (code === 256) { bits = 9; next = 258; prev = -1; continue; }
        if (prev < 0) {
            if (code > 255) break;
            out[op++] = code;
            prev = code;
            continue;
        }
        if (code > next || next >= 4096) break;
        // The code's bytes: its own, or (a code not yet in the table) the last one's with its first byte again
        const known = code < next;
        const from = known ? code : prev;
        const n = size[from];
        let c = from;
        for (let i = n - 1; i >= 0; i--) {
            if (op + i < length) out[op + i] = suffix[c];
            c = prefix[c];
        }
        if (!known && op + n < length) out[op + n] = first[prev];
        op += known ? n : n + 1;
        prefix[next] = prev;
        suffix[next] = known ? first[code] : first[prev];
        first[next] = first[prev];
        size[next] = size[prev] + 1;
        next++;
        if (next >= (1 << bits) - 1 && bits < 12) bits++;
        prev = code;
    }
    return out;
}

/** PackBits, to `length` bytes */
export function unPackBits(src: Uint8Array, length: number): Uint8Array {
    const out = new Uint8Array(length);
    let ip = 0, op = 0;
    while (ip < src.length && op < length) {
        const n = src[ip++] << 24 >> 24;
        if (n >= 0) { for (let k = 0; k <= n && ip < src.length && op < length; k++) out[op++] = src[ip++]; }
        else if (n !== -128) { const v = src[ip++]; for (let k = 0; k <= -n && op < length; k++) out[op++] = v; }
    }
    return out;
}

/** Deflate (a zlib stream), to `length` bytes */
async function inflate(src: Uint8Array, length: number): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') throw new NotTopography('This browser cannot unpack the file (Deflate): save it unpacked, or as an ESRI ASCII grid.');
    const stream = new Blob([src as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
    const got = new Uint8Array(await new Response(stream).arrayBuffer());
    if (got.length === length) return got;
    const out = new Uint8Array(length);
    out.set(got.subarray(0, length));
    return out;
}

const PACKING: Record<number, string> = { 2: 'CCITT', 3: 'CCITT', 4: 'CCITT', 6: 'JPEG', 7: 'JPEG', 34712: 'JPEG 2000', 34887: 'LERC', 50000: 'Zstandard', 50001: 'WebP', 34925: 'LZMA' };

/**
 * The heights in a GeoTIFF. Throws NotTopography, with a sentence for the
 * user, for what is not a file of heights or is one this does not read.
 */
export async function readGeoTiff(buffer: ArrayBuffer): Promise<HeightGrid> {
    try {
        return await read(buffer);
    } catch (e) {
        // (A place in the file that is past its end)
        if (e instanceof RangeError) throw new NotTopography('The TIFF file is cut short or damaged.');
        throw e;
    }
}

async function read(buffer: ArrayBuffer): Promise<HeightGrid> {
    const view = new DataView(buffer);
    const { entries, little } = directory(view);
    const one = (tag: number, or: number) => { const v = numbers(view, little, entries.get(tag)); return v.length > 0 ? v[0] : or; };
    const nx = one(TAG.width, 0), ny = one(TAG.height, 0);
    if (!(nx >= 2) || !(ny >= 2)) throw new NotTopography('The TIFF file holds no grid.');
    const samples = one(TAG.samples, 1);
    if (samples !== 1) throw new NotTopography(`It has ${samples} bands: this is a picture, not heights (a file of heights has one band).`);
    const bits = one(TAG.bits, 1), format = one(TAG.format, 1), compression = one(TAG.compression, 1), predictor = one(TAG.predictor, 1);
    const float = format === 3, signed = format === 2;
    if (!((float && (bits === 32 || bits === 64)) || (!float && (format === 1 || format === 2) && (bits === 8 || bits === 16 || bits === 32)))) {
        throw new NotTopography(`Its heights are ${bits}-bit ${float ? 'floats' : format === 1 || format === 2 ? 'whole numbers' : 'values of a kind not known here'}: that is not read. Save it as 32-bit floats.`);
    }
    if (![1, 5, 8, 32946, 32773].includes(compression)) {
        throw new NotTopography(`It is packed with ${PACKING[compression] ?? `a method (${compression})`} that is not read here: save it with LZW or Deflate, or not packed.`);
    }
    if (nx * ny > MOST_CELLS) throw new NotTopography(`The grid has ${(nx * ny).toLocaleString()} cells, more than can be read here: save it coarser (a cell of 5 to 25 m is plenty for the top of a model).`);

    // ---- where it is ----
    const keys = numbers(view, little, entries.get(TAG.geoKeys));
    const geoKey = (id: number): number | null => { for (let k = 4; k + 3 < keys.length; k += 4) if (keys[k] === id && keys[k + 1] === 0) return keys[k + 3]; return null; };
    // (A cell's value is of its middle; "area" files place the cell's corner, "point" files its middle)
    const half = geoKey(1025) === 2 ? 0 : 0.5;
    const scale = numbers(view, little, entries.get(TAG.pixelScale)), tie = numbers(view, little, entries.get(TAG.tiepoint)), matrix = numbers(view, little, entries.get(TAG.transformation));
    let dx: number, dy: number, west: number, north: number;
    if (scale.length >= 2 && tie.length >= 6) {
        dx = scale[0]; dy = scale[1];
        west = tie[3] + (half - tie[0]) * dx;
        north = tie[4] - (half - tie[1]) * dy;
    } else if (matrix.length >= 8) {
        if (Math.abs(matrix[1]) > 1e-9 * Math.abs(matrix[0]) || Math.abs(matrix[4]) > 1e-9 * Math.abs(matrix[5])) throw new NotTopography('Its grid is turned (it does not run east and north): that is not read. Save it north up (in QGIS: Raster > Projections > Warp).');
        dx = matrix[0]; dy = -matrix[5];
        west = matrix[3] + half * dx;
        north = matrix[7] - half * dy;
    } else {
        throw new NotTopography('The TIFF does not say where it is (it is not a GeoTIFF; a world file beside it is not read). Save it as a GeoTIFF, or as an ESRI ASCII grid.');
    }
    if (!(dx > 0) || !Number.isFinite(dy) || dy === 0) throw new NotTopography('The TIFF does not say the size of its cells.');
    if (geoKey(1024) === 2 || (Math.abs(dx) < 0.01 && Math.abs(west) <= 360 && Math.abs(north) <= 90)) {
        throw new NotTopography('It is in latitude and longitude (degrees): it has to be in metres, in the grid the drilling is in. Reproject it first (in QGIS: Raster > Projections > Warp, to the drilling\'s MGA or UTM zone).');
    }

    // ---- its values ----
    const tiled = entries.has(TAG.tileOffsets);
    const offsets = numbers(view, little, entries.get(tiled ? TAG.tileOffsets : TAG.stripOffsets));
    const counts = numbers(view, little, entries.get(tiled ? TAG.tileCounts : TAG.stripCounts));
    const pieceW = tiled ? one(TAG.tileWidth, 0) : nx;
    const pieceH = tiled ? one(TAG.tileHeight, 0) : Math.min(ny, one(TAG.rowsPerStrip, ny));
    if (!(pieceW > 0) || !(pieceH > 0) || offsets.length === 0) throw new NotTopography('The TIFF file holds no grid.');
    const across = tiled ? Math.ceil(nx / pieceW) : 1, down = Math.ceil(ny / pieceH);
    if (offsets.length < across * down) throw new NotTopography('The TIFF file is cut short.');
    const bytes = bits / 8;
    const noDataEntry = entries.get(TAG.noData);
    let none = NaN;
    if (noDataEntry) {
        const text = String.fromCharCode(...numbers(view, little, noDataEntry).filter(c => c > 0)).trim();
        none = text.toLowerCase() === 'nan' ? NaN : Number(text);
        if (float && bits === 32) none = Math.fround(none);
    }
    const whole = new Uint8Array(buffer);
    const z = new Float32Array(nx * ny).fill(NaN);
    // (Rows of the file run from the north when dy > 0: the grid's rows run from the south)
    const rowOf = (r: number) => (dy > 0 ? ny - 1 - r : r);
    for (let p = 0; p < across * down; p++) {
        const length = pieceW * pieceH * bytes;
        const at = offsets[p], packed = counts[p] ?? 0;
        if (packed === 0) continue;
        if (at + packed > whole.length) throw new NotTopography('The TIFF file is cut short.');
        const src = whole.subarray(at, at + packed);
        let raw: Uint8Array;
        if (compression === 1) { raw = new Uint8Array(length); raw.set(src.subarray(0, length)); }
        else if (compression === 5) raw = unLzw(src, length);
        else if (compression === 32773) raw = unPackBits(src, length);
        else raw = await inflate(src, length);
        // Predictors: each value kept as its difference from the one before it in its row
        if (predictor === 2) {
            if (bytes === 1) { for (let r = 0; r < pieceH; r++) for (let c = 1, o = r * pieceW; c < pieceW; c++) raw[o + c] = (raw[o + c] + raw[o + c - 1]) & 255; }
            else {
                const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
                for (let r = 0; r < pieceH; r++) for (let c = 1; c < pieceW; c++) {
                    const o = (r * pieceW + c) * bytes;
                    if (bytes === 2) v.setUint16(o, (v.getUint16(o, little) + v.getUint16(o - 2, little)) & 0xffff, little);
                    else if (bytes === 4) v.setUint32(o, (v.getUint32(o, little) + v.getUint32(o - 4, little)) >>> 0, little);
                    else v.setBigUint64(o, BigInt.asUintN(64, v.getBigUint64(o, little) + v.getBigUint64(o - 8, little)), little);
                }
            }
        } else if (predictor === 3) {
            // Floats: the bytes of a row sorted by their place in the value (the most significant first), then differenced
            const row = new Uint8Array(pieceW * bytes);
            for (let r = 0; r < pieceH; r++) {
                const o = r * pieceW * bytes;
                for (let k = 1; k < pieceW * bytes; k++) raw[o + k] = (raw[o + k] + raw[o + k - 1]) & 255;
                row.set(raw.subarray(o, o + pieceW * bytes));
                for (let c = 0; c < pieceW; c++) for (let b = 0; b < bytes; b++) raw[o + c * bytes + (little ? bytes - 1 - b : b)] = row[b * pieceW + c];
            }
        } else if (predictor !== 1) {
            throw new NotTopography('It is packed with a predictor that is not read here: save it with LZW or Deflate and no predictor, or not packed.');
        }
        const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        const r0 = Math.floor(p / across) * pieceH, c0 = (p % across) * pieceW;
        const rows = Math.min(pieceH, ny - r0), cols = Math.min(pieceW, nx - c0);
        for (let r = 0; r < rows; r++) {
            const to = rowOf(r0 + r) * nx + c0;
            for (let c = 0; c < cols; c++) {
                const o = (r * pieceW + c) * bytes;
                const value = float ? (bytes === 4 ? v.getFloat32(o, little) : v.getFloat64(o, little))
                    : bytes === 1 ? (signed ? v.getInt8(o) : v.getUint8(o))
                    : bytes === 2 ? (signed ? v.getInt16(o, little) : v.getUint16(o, little))
                    : signed ? v.getInt32(o, little) : v.getUint32(o, little);
                // (No height: the file's own value for none, and the values other programs use for it)
                if (value !== none && Number.isFinite(value) && value > -1e30 && value < 1e30) z[to + c] = value;
            }
        }
    }
    const ady = Math.abs(dy);
    // The middle of the south-west cell
    const south = dy > 0 ? north - (ny - 1) * ady : north;
    return { nx, ny, x0: west, y0: south, dx, dy: ady, z, notes: [] };
}
