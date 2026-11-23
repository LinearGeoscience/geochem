/**
 * A fit as a file (Phase 224): whatever a fit is made of (plain objects,
 * lists, numbers, text and arrays of numbers, nested as they come: a field,
 * its blocks, the field it is an offset of, a mesh) written as one block of
 * bytes and read back the same.
 *
 * The file: 'GFIT', a version, the length of its head, the head (JSON:
 * what it is the fit of, and the shape of the value with each array of
 * numbers replaced by where its numbers are), then the numbers themselves,
 * each array starting on a multiple of 8 bytes, as the machine holds them
 * (little-endian on everything this runs on; the head says so, and a file
 * from a machine that held them the other way round is not read).
 *
 * An array or object met twice in the value is written once, and is one
 * object again when read (a field that is an offset of another carries
 * that other; two parts of a fit may share it).
 */

const MAGIC = 0x54494647; // 'GFIT', little-endian
export const FIT_FILE_VERSION = 1;

const ARRAYS = {
    f64: Float64Array, f32: Float32Array, i32: Int32Array, u32: Uint32Array, i16: Int16Array, u16: Uint16Array, i8: Int8Array, u8: Uint8Array,
} as const;
type ArrayName = keyof typeof ARRAYS;
type Numbers = InstanceType<(typeof ARRAYS)[ArrayName]>;

const nameOf = (a: object): ArrayName | null => {
    for (const name of Object.keys(ARRAYS) as ArrayName[]) if (a.constructor === ARRAYS[name]) return name;
    return null;
};

const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Something in a fit that a file cannot hold (a function, a Map, a class of its own): the fit is then simply not saved */
export class NotSavable extends Error {}

interface Head {
    version: number;
    little: boolean;
    /** What the value is the fit of: read without reading the rest */
    about: unknown;
    value: unknown;
    /** Bytes of numbers after the head */
    bytes: number;
}

/**
 * Write a value as a file's bytes. `about`: a small plain value (the fit's
 * key and the like) that `readFitHead` gives back without the numbers.
 */
export function encodeFit(value: unknown, about: unknown = null): Uint8Array {
    const blocks: { at: number; array: Numbers }[] = [];
    const placed = new Map<object, unknown>();
    const seen = new Map<object, number>();
    let bytes = 0, count = 0;
    const walk = (v: unknown): unknown => {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : { $: 'n', v: String(v) };
        if (typeof v === 'string' || typeof v === 'boolean') return v;
        if (typeof v !== 'object') throw new NotSavable(`A ${typeof v} cannot be saved`);
        if (ArrayBuffer.isView(v)) {
            const was = placed.get(v);
            if (was) return was;
            const name = nameOf(v);
            if (!name) throw new NotSavable('An array of numbers of a kind that cannot be saved');
            const array = v as Numbers;
            const ref = { $: 'a', t: name, o: bytes, n: array.length };
            blocks.push({ at: bytes, array });
            bytes += Math.ceil(array.byteLength / 8) * 8;
            placed.set(v, ref);
            return ref;
        }
        const again = seen.get(v);
        if (again !== undefined) return { $: 'r', i: again };
        seen.set(v, count++);
        if (Array.isArray(v)) return v.map(walk);
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) throw new NotSavable(`A ${(v as object).constructor?.name ?? 'thing'} cannot be saved`);
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) {
            if (x === undefined) continue;
            if (k === '$') throw new NotSavable('A value named $ cannot be saved');
            out[k] = walk(x);
        }
        return out;
    };
    const shape = walk(value);
    const head: Head = { version: FIT_FILE_VERSION, little: LITTLE, about, value: shape, bytes };
    const text = new TextEncoder().encode(JSON.stringify(head));
    const start = 12 + Math.ceil(text.length / 8) * 8 + 4; // (12 + 4: the numbers start on a multiple of 8)
    const out = new Uint8Array(start + bytes);
    const view = new DataView(out.buffer);
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, FIT_FILE_VERSION, true);
    view.setUint32(8, text.length, true);
    out.set(text, 12);
    for (const b of blocks) out.set(new Uint8Array(b.array.buffer, b.array.byteOffset, b.array.byteLength), start + b.at);
    return out;
}

function headOf(bytes: Uint8Array): { head: Head; start: number } | null {
    if (bytes.length < 16) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== FIT_FILE_VERSION) return null;
    const length = view.getUint32(8, true);
    const start = 12 + Math.ceil(length / 8) * 8 + 4;
    if (start > bytes.length) return null;
    try {
        const head = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + length))) as Head;
        if (head.version !== FIT_FILE_VERSION || head.little !== LITTLE || start + head.bytes !== bytes.length) return null;
        return { head, start };
    } catch {
        return null;
    }
}

/** What a file says it is the fit of (`about`), without reading its numbers. Null: not a fit file this version reads, or cut short. */
export function readFitHead(bytes: Uint8Array): { about: unknown } | null {
    const read = headOf(bytes);
    return read && { about: read.head.about };
}

/** Read a file's bytes back as the value written. Null: not a fit file this version reads, or one cut short or damaged. */
export function decodeFit(bytes: Uint8Array): { about: unknown; value: unknown } | null {
    const read = headOf(bytes);
    if (!read) return null;
    const { head, start } = read;
    const arrays = new Map<number, Numbers>();
    const made: unknown[] = [];
    let ok = true;
    const walk = (v: unknown): unknown => {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) {
            const out: unknown[] = [];
            made.push(out);
            for (const x of v) out.push(walk(x));
            return out;
        }
        const o = v as Record<string, unknown>;
        if (o.$ === 'n') return Number(o.v);
        if (o.$ === 'r') {
            if (typeof o.i !== 'number' || o.i >= made.length) { ok = false; return null; }
            return made[o.i];
        }
        if (o.$ === 'a') {
            const at = o.o as number, n = o.n as number, type = ARRAYS[o.t as ArrayName];
            if (!type || !Number.isInteger(at) || !Number.isInteger(n) || at < 0 || n < 0 || at + n * type.BYTES_PER_ELEMENT > head.bytes) { ok = false; return null; }
            const was = arrays.get(at);
            // (Two arrays of nothing may share a place: each is its own)
            if (was && was.constructor === type && was.length === n && n > 0) return was;
            // Its own memory: a fit handed to a worker takes only its own numbers with it
            const from = bytes.byteOffset + start + at;
            const array = new type(bytes.buffer.slice(from, from + n * type.BYTES_PER_ELEMENT) as ArrayBuffer);
            if (n > 0) arrays.set(at, array);
            return array;
        }
        const out: Record<string, unknown> = {};
        made.push(out);
        for (const [k, x] of Object.entries(o)) out[k] = walk(x);
        return out;
    };
    const value = walk(head.value);
    return ok ? { about: head.about, value } : null;
}
