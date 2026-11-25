/**
 * A zip file of a few small files, stored as they are (no compression): the
 * least that every unzipper reads. Pure, unit-tested.
 */

export interface ZipEntry {
    /** Its path inside the zip, with / between folders */
    path: string;
    data: string | Uint8Array;
}

let table: Uint32Array | null = null;

/** The CRC-32 of some bytes (as zip, PNG and gzip use it). */
export function crc32(bytes: Uint8Array): number {
    if (!table) {
        table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** The zip's date and time words for a moment (local time, to two seconds). */
function dosTime(when: Date): { time: number; date: number } {
    return {
        time: (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1),
        date: ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
    };
}

/**
 * The files of a zip, as bytes. Stored files are read as they are; deflated
 * ones (a kit unzipped and zipped again by hand) where the browser can
 * inflate them. Folders, and files it cannot read, are left out. Throws when
 * the bytes are not a zip.
 */
export async function unzip(bytes: Uint8Array): Promise<{ path: string; data: Uint8Array }[]> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The end record: in the last 64 KB, behind any comment
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
        if (view.getUint32(at, true) === 0x06054b50) { end = at; break; }
    }
    if (end < 0) throw new Error('This is not a zip file.');
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const text = new TextDecoder();
    const out: { path: string; data: Uint8Array }[] = [];
    for (let k = 0; k < count && at + 46 <= bytes.length && view.getUint32(at, true) === 0x02014b50; k++) {
        const method = view.getUint16(at + 10, true), packed = view.getUint32(at + 20, true);
        const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
        const local = view.getUint32(at + 42, true);
        const path = text.decode(bytes.subarray(at + 46, at + 46 + nameLength));
        at += 46 + nameLength + extra + comment;
        if (path.endsWith('/') || local + 30 > bytes.length) continue;
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = bytes.subarray(start, start + packed);
        if (method === 0) out.push({ path, data: raw.slice() });
        else if (method === 8 && typeof DecompressionStream !== 'undefined') {
            try {
                const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                out.push({ path, data: new Uint8Array(await new Response(stream).arrayBuffer()) });
            } catch { /* left out */ }
        }
    }
    return out;
}

/** These files as one zip. Names are written as UTF-8. */
export function zipStore(entries: readonly ZipEntry[], when: Date = new Date()): Uint8Array {
    const text = new TextEncoder();
    const files = entries.map(e => {
        const name = text.encode(e.path.replace(/\\/g, '/').replace(/^\/+/, ''));
        const data = typeof e.data === 'string' ? text.encode(e.data) : e.data;
        return { name, data, crc: crc32(data) };
    });
    const { time, date } = dosTime(when);
    const size = files.reduce((n, f) => n + 30 + f.name.length + f.data.length + 46 + f.name.length, 22);
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let at = 0;
    const starts: number[] = [];
    // What both of a file's headers say of it: version 2.0, names in UTF-8, stored, when, check, sizes, name length
    const common = (f: typeof files[number]) => {
        view.setUint16(at, 20, true);
        view.setUint16(at + 2, 0x0800, true);
        view.setUint16(at + 4, 0, true);
        view.setUint16(at + 6, time, true);
        view.setUint16(at + 8, date, true);
        view.setUint32(at + 10, f.crc, true);
        view.setUint32(at + 14, f.data.length, true);
        view.setUint32(at + 18, f.data.length, true);
        view.setUint16(at + 22, f.name.length, true);
        view.setUint16(at + 24, 0, true);
        at += 26;
    };
    for (const f of files) {
        starts.push(at);
        view.setUint32(at, 0x04034b50, true);
        at += 4;
        common(f);
        out.set(f.name, at);
        at += f.name.length;
        out.set(f.data, at);
        at += f.data.length;
    }
    const directory = at;
    files.forEach((f, i) => {
        view.setUint32(at, 0x02014b50, true);
        view.setUint16(at + 4, 20, true);
        at += 6;
        common(f);
        // No comment, disk 0, no attributes, then where the file starts
        view.setUint32(at + 10, starts[i], true);
        at += 14;
        out.set(f.name, at);
        at += f.name.length;
    });
    view.setUint32(at, 0x06054b50, true);
    view.setUint16(at + 8, files.length, true);
    view.setUint16(at + 10, files.length, true);
    view.setUint32(at + 12, at - directory, true);
    view.setUint32(at + 16, directory, true);
    return out;
}
