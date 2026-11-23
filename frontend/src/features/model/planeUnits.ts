/**
 * The units of a model on a plane, traced from what the model is at places
 * on the plane rather than from its solids (pure, unit-tested).
 *
 * A model's solids are as blocky as its cells (tens of metres on a mine-sized
 * box), and so was a section cut through them. The model itself knows its
 * unit at any place, from the surfaces it was built from. So a section reads
 * it there: at places a few metres apart where units meet, and coarsely
 * where one unit fills the ground. Each outline then passes between two
 * places with different units, moved to where the unit changes.
 *
 * What is read is a label per place (a unit's number, or `outside`). The
 * places are the nodes of a grid `step` apart. Cells of `COARSE` steps are
 * read first; one whose corners and middle agree is taken to be all that
 * unit, any other is halved and read again, down to one step. So a unit
 * thinner than `COARSE` steps that crosses no place read may be missed in
 * the middle of another, as one thinner than a step always may.
 *
 * The outlines of all the labels together leave no ground out. A cell one
 * step across is shared out between the labels at its corners: where there
 * are two and each is on one side, by the line between the two places the
 * unit changes; where the same label is at two opposite corners and another
 * at the other two, the label in the middle of the cell (read for it) is
 * the one that runs through; where there are three labels or more, each
 * corner has the ground between it and the place the units meet (`meeting`
 * below). (Each label
 * used to be cut off at its own corners, which left the middle of such a
 * cell to no unit: white slits between two thin sheets close together.)
 */

export interface PlaneWindow { u0: number; u1: number; v0: number; v1: number }

/** Cells this many steps across are read first */
export const COARSE = 8;
/** The step is made large enough that there are no more nodes than this */
export const TRACE_NODES = 400_000;
/** Each crossing is halved this many times: an outline is within step / 2^(n+1) of where the unit changes (2 mm at a 1 m step) */
const HALVINGS = 8;
/** Points this share of a step off the straight line between their neighbours are left out of an outline */
const SIMPLIFY = 0.15;

const UNKNOWN = -32768;

export interface Traced {
    /** How far apart the places read are, m */
    step: number;
    /** How many places were read */
    read: number;
    /** Per label but `outside`: its outlines (u, v pairs; each comes back to where it starts) */
    loops: Map<number, Float64Array[]>;
    /** The outlines of all that is not `outside` */
    hull: Float64Array[];
}

/** The step a window is traced at when none is asked for: 1 m, or more where that would be too many nodes */
export function traceStep(window: PlaneWindow, least = 1): number {
    const area = Math.max(window.u1 - window.u0, 0) * Math.max(window.v1 - window.v0, 0);
    return Math.max(least, Math.sqrt(area / TRACE_NODES));
}

/** A closed line with the points that add nothing left out (Douglas and Peucker's way), u, v pairs */
function simplified(line: number[], tolerance: number): Float64Array {
    const n = line.length / 2 - 1;
    if (n < 4 || !(tolerance > 0)) return Float64Array.from(line);
    // Cut at its first point and the one furthest from it: each half is an open line
    let far = 0, best = -1;
    for (let i = 1; i < n; i++) {
        const d = (line[i * 2] - line[0]) ** 2 + (line[i * 2 + 1] - line[1]) ** 2;
        if (d > best) { best = d; far = i; }
    }
    const keep = new Uint8Array(n + 1);
    keep[0] = keep[far] = keep[n] = 1;
    const stack: number[] = [0, far, far, n];
    while (stack.length > 0) {
        const b = stack.pop()!, a = stack.pop()!;
        if (b - a < 2) continue;
        const ax = line[a * 2], ay = line[a * 2 + 1], dx = line[b * 2] - ax, dy = line[b * 2 + 1] - ay;
        const len = Math.hypot(dx, dy);
        let worst = -1, at = -1;
        for (let i = a + 1; i < b; i++) {
            const px = line[i * 2] - ax, py = line[i * 2 + 1] - ay;
            const d = len > 0 ? Math.abs(px * dy - py * dx) / len : Math.hypot(px, py);
            if (d > worst) { worst = d; at = i; }
        }
        if (worst > tolerance) { keep[at] = 1; stack.push(a, at, at, b); }
    }
    const out: number[] = [];
    for (let i = 0; i <= n; i++) if (keep[i]) out.push(line[i * 2], line[i * 2 + 1]);
    return Float64Array.from(out);
}

/**
 * The outlines of each label on a window of a plane. `labelAt`: the labels
 * at places on the plane (u, v pairs). `outside`: the label of a place that
 * is in nothing; everything past the window counts as that.
 */
export function traceLabels(
    labelAt: (uv: Float64Array) => ArrayLike<number>, window: PlaneWindow, options: { step?: number; outside?: number } = {},
): Traced {
    const outside = options.outside ?? -1;
    const step = options.step && options.step > 0 ? options.step : traceStep(window);
    const empty: Traced = { step, read: 0, loops: new Map(), hull: [] };
    if (!(window.u1 > window.u0) || !(window.v1 > window.v0)) return empty;
    // A ring of cells past the window all round, and a whole number of coarse cells
    const cells = (span: number) => Math.ceil((Math.ceil(span / step - 1e-9) + 2) / COARSE) * COARSE;
    const cu = cells(window.u1 - window.u0), cv = cells(window.v1 - window.v0);
    const nu = cu + 1, nv = cv + 1;
    const U0 = (window.u0 + window.u1) / 2 - cu * step / 2, V0 = (window.v0 + window.v1) / 2 - cv * step / 2;
    const labels = new Int16Array(nu * nv).fill(UNKNOWN);
    // The outermost nodes are past the window: outside, without being read
    for (let i = 0; i < nu; i++) labels[i] = labels[(nv - 1) * nu + i] = outside;
    for (let j = 0; j < nv; j++) labels[j * nu] = labels[j * nu + nu - 1] = outside;

    let read = 0;
    const readNodes = (nodes: number[]) => {
        if (nodes.length === 0) return;
        const uv = new Float64Array(nodes.length * 2);
        nodes.forEach((k, q) => { uv[q * 2] = U0 + (k % nu) * step; uv[q * 2 + 1] = V0 + Math.floor(k / nu) * step; });
        const got = labelAt(uv);
        nodes.forEach((k, q) => { labels[k] = got[q]; });
        read += nodes.length;
    };

    // Coarse cells first; those that are not all one label are halved, down to one step
    let level: number[] = [];
    for (let j = 0; j < cv; j += COARSE) for (let i = 0; i < cu; i += COARSE) level.push(j * nu + i);
    const uniform: number[] = [];
    for (let size = COARSE; size >= 1; size /= 2) {
        const half = size / 2;
        const want = new Set<number>();
        const ask = (k: number) => { if (labels[k] === UNKNOWN) want.add(k); };
        for (const k of level) {
            ask(k); ask(k + size); ask(k + size * nu); ask(k + size * nu + size);
            if (size > 1) ask(k + half * nu + half);
        }
        readNodes([...want]);
        const next: number[] = [];
        for (const k of level) {
            const a = labels[k];
            const same = labels[k + size] === a && labels[k + size * nu] === a && labels[k + size * nu + size] === a
                && (size === 1 || labels[k + half * nu + half] === a);
            if (same) { if (size > 1) uniform.push(k, size); continue; }
            if (size > 1) next.push(k, k + half, k + half * nu, k + half * nu + half);
        }
        level = next;
    }
    for (let q = 0; q < uniform.length; q += 2) {
        const k = uniform[q], size = uniform[q + 1], a = labels[k];
        for (let dj = 0; dj <= size; dj++) for (let di = 0; di <= size; di++) {
            const at = k + dj * nu + di;
            if (labels[at] === UNKNOWN) labels[at] = a;
        }
    }
    // The cells one step across that are not all one label: the outlines pass through these. Looked for over the whole
    // grid, not only where cells were halved: a node on the edge of a cell taken to be all one unit may have been read
    // from the cell next to it as another
    const mixed: number[] = [];
    for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++) {
        const k = j * nu + i, a = labels[k];
        if (labels[k + 1] !== a || labels[k + nu] !== a || labels[k + nu + 1] !== a) mixed.push(k);
    }
    if (mixed.length === 0) return { ...empty, read };

    // The cells no line between two crossings shares out: the same label at two opposite corners only (which of the two
    // runs through is what is in the middle), and three labels or more (each corner out to the middle)
    const through = new Map<number, number>(), hubs = new Set<number>();
    {
        const unsure: number[] = [];
        for (const k of mixed) {
            const a = labels[k], b = labels[k + 1], c = labels[k + nu + 1], d = labels[k + nu];
            const saddle = a === c && b === d;
            if (saddle || new Set([a, b, c, d]).size > 2) unsure.push(k);
        }
        if (unsure.length > 0) {
            const uv = new Float64Array(unsure.length * 2);
            unsure.forEach((k, q) => { uv[q * 2] = U0 + (k % nu + 0.5) * step; uv[q * 2 + 1] = V0 + (Math.floor(k / nu) + 0.5) * step; });
            const got = labelAt(uv);
            read += unsure.length;
            unsure.forEach((k, q) => {
                const a = labels[k], b = labels[k + 1];
                if (a === labels[k + nu + 1] && b === labels[k + nu] && (got[q] === a || got[q] === b)) through.set(k, got[q]);
                else hubs.add(k);
            });
        }
    }
    // Where the label changes along each edge of those cells, as a share of the way along it: halved towards the change
    // (Edge 2k runs from node k to the next along u; edge 2k + 1 to the next along v)
    const edges = new Map<number, { lo: number; hi: number }>();
    const edge = (id: number, a: number, b: number) => { if (labels[a] !== labels[b] && !edges.has(id)) edges.set(id, { lo: 0, hi: 1 }); };
    for (const k of mixed) {
        edge(2 * k, k, k + 1);
        edge(2 * (k + nu), k + nu, k + nu + 1);
        edge(2 * k + 1, k, k + nu);
        edge(2 * (k + 1) + 1, k + 1, k + nu + 1);
    }
    const ids = [...edges.keys()];
    const place = (id: number, t: number): [number, number] => {
        const k = id >> 1, i = k % nu, j = Math.floor(k / nu);
        return id & 1 ? [U0 + i * step, V0 + (j + t) * step] : [U0 + (i + t) * step, V0 + j * step];
    };
    for (let round = 0; round < HALVINGS; round++) {
        const uv = new Float64Array(ids.length * 2);
        ids.forEach((id, q) => { const e = edges.get(id)!; const p = place(id, (e.lo + e.hi) / 2); uv[q * 2] = p[0]; uv[q * 2 + 1] = p[1]; });
        const got = labelAt(uv);
        read += ids.length;
        ids.forEach((id, q) => {
            const e = edges.get(id)!, mid = (e.lo + e.hi) / 2;
            // (Still the label the edge starts in: the change is further along)
            if (got[q] === labels[id >> 1]) e.lo = mid;
            else e.hi = mid;
        });
    }
    const crossing = (id: number): [number, number] => { const e = edges.get(id)!; return place(id, (e.lo + e.hi) / 2); };
    /**
     * Where the units of a cell meet. One label at two corners side by side and another at each of the other two (a
     * contact that ends against a third unit): the first keeps the straight line between its two crossings, and the
     * meeting place is on that line, nearest the crossing between the other two. Otherwise the middle of the
     * crossings on the cell's sides.
     */
    const meeting = (k: number): [number, number] => {
        const corners = [labels[k], labels[k + 1], labels[k + nu + 1], labels[k + nu]];
        const sides = [2 * k, 2 * (k + 1) + 1, 2 * (k + nu), 2 * k + 1];
        if (new Set(corners).size === 3) for (let q = 0; q < 4; q++) {
            if (corners[q] !== corners[(q + 1) % 4]) continue;
            const a = crossing(sides[(q + 3) % 4]), b = crossing(sides[(q + 1) % 4]), c = crossing(sides[(q + 2) % 4]);
            const du = b[0] - a[0], dv = b[1] - a[1], l2 = du * du + dv * dv;
            const t = l2 > 0 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * du + (c[1] - a[1]) * dv) / l2)) : 0;
            return [a[0] + t * du, a[1] + t * dv];
        }
        let u = 0, v = 0, n = 0;
        for (const side of sides) if (edges.has(side)) { const p = crossing(side); u += p[0]; v += p[1]; n++; }
        return [u / n, v / n];
    };
    // (A crossing; or, under nought, the meeting place of a cell: one of its own for each piece of outline that turns there)
    const at = (id: number): [number, number] => (id >= 0 ? crossing(id) : meeting(Math.floor((-id - 1) / 4)));

    /** The outlines of the nodes that `inside` says yes to */
    const outlines = (inside: (label: number) => boolean): Float64Array[] => {
        // Each crossing is an end of two pieces of outline, one in each cell the edge is between
        const links = new Map<number, number[]>();
        const join = (a: number, b: number) => {
            const la = links.get(a), lb = links.get(b);
            if (la) la.push(b); else links.set(a, [b]);
            if (lb) lb.push(a); else links.set(b, [a]);
        };
        for (const k of mixed) {
            const code = (inside(labels[k]) ? 1 : 0) | (inside(labels[k + 1]) ? 2 : 0) | (inside(labels[k + nu + 1]) ? 4 : 0) | (inside(labels[k + nu]) ? 8 : 0);
            if (code === 0 || code === 15) continue;
            const bottom = 2 * k, right = 2 * (k + 1) + 1, top = 2 * (k + nu), left = 2 * k + 1;
            if (hubs.has(k)) {
                // Each run of corners that are inside, going round the cell: from the crossing before it, by the middle,
                // to the crossing after it (round the cell: corner q is between side q - 1 and side q)
                const sides = [bottom, right, top, left];
                for (let q = 0; q < 4; q++) {
                    if (!(code & (1 << q)) || (code & (1 << ((q + 3) % 4)))) continue;
                    let last = q;
                    while (code & (1 << ((last + 1) % 4))) last = (last + 1) % 4;
                    const hub = -(4 * k + q) - 1;
                    join(sides[(q + 3) % 4], hub);
                    join(hub, sides[last]);
                }
                continue;
            }
            // (Two opposite corners inside: joined through the middle where the middle is inside, else each cut off)
            const joined = (code === 5 || code === 10) && through.has(k) && inside(through.get(k)!);
            if (joined) {
                if (code === 5) { join(bottom, right); join(left, top); } else { join(left, bottom); join(right, top); }
                continue;
            }
            switch (code) {
                case 1: case 14: join(left, bottom); break;
                case 2: case 13: join(bottom, right); break;
                case 3: case 12: join(left, right); break;
                case 4: case 11: join(right, top); break;
                case 6: case 9: join(bottom, top); break;
                case 7: case 8: join(left, top); break;
                // Two corners that touch only at the middle: each is cut off on its own
                case 5: join(left, bottom); join(right, top); break;
                default: join(bottom, right); join(left, top); break;
            }
        }
        const out: Float64Array[] = [];
        const done = new Set<number>();
        for (const start of links.keys()) {
            if (done.has(start)) continue;
            const line: number[] = [];
            let prev = -1, here = start;
            for (let guard = 0; guard <= links.size; guard++) {
                done.add(here);
                line.push(...at(here));
                const ends = links.get(here)!;
                // (Where both of its pieces lead to the same crossing, the second is the way on)
                const next = ends[0] !== prev ? ends[0] : ends[1];
                if (next === undefined || next === start) break;
                prev = here;
                here = next;
            }
            if (line.length < 6) continue;
            line.push(line[0], line[1]);
            const kept = simplified(line, SIMPLIFY * step);
            if (kept.length >= 8) out.push(kept);
        }
        return out;
    };

    const seen = new Set<number>();
    for (const k of mixed) for (const n of [k, k + 1, k + nu, k + nu + 1]) seen.add(labels[n]);
    const loops = new Map<number, Float64Array[]>();
    for (const label of [...seen].sort((a, b) => a - b)) {
        if (label === outside) continue;
        const lines = outlines(l => l === label);
        if (lines.length > 0) loops.set(label, lines);
    }
    return { step, read, loops, hull: outlines(l => l !== outside) };
}
