/**
 * Drillholes in the 3D viewer's data, for finding one by name (pure, no
 * three.js, unit-tested): which rows belong to each hole, where it is, and a
 * search over the hole IDs.
 */
import { tracePolyline, type HoleTrace } from '../../model/desurvey';
import type { Vec3 } from './slices';

export interface HoleInfo {
    id: string;
    /** The hole's samples, down the hole (by depth; as stored when there is no depth column) */
    rows: Uint32Array;
    /** Box around its samples (local coordinates) */
    min: Vec3;
    max: Vec3;
    /** Shallowest and deepest depth of its samples; null without a depth column */
    depthFrom: number | null;
    depthTo: number | null;
}

export interface HoleIndex {
    /** In natural order of their IDs (DH2 before DH10) */
    holes: HoleInfo[];
    /** Per dataset row: its hole's place in `holes`, -1 for none */
    holeOfRow: Int32Array;
}

const isMissing = (v: unknown) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/** Order for hole IDs: numbers inside a name count as numbers (DH2, DH10, DH10A). */
export const naturalCompare = (a: string, b: string) => collator.compare(a, b);

/**
 * `positions` / `valid` are the point cloud's (local coordinates, 3 per row).
 * `depth` orders the samples down each hole (From, or a depth column); `to`
 * gives the end of the last sample when there is one.
 */
export function buildHoleIndex(
    positions: ArrayLike<number>,
    valid: ArrayLike<number>,
    holeIds: ArrayLike<unknown>,
    depth: ArrayLike<number> | null,
    to: ArrayLike<number> | null,
): HoleIndex {
    const n = valid.length;
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
        if (!valid[i] || isMissing(holeIds[i])) continue;
        const id = String(holeIds[i]).trim();
        if (!id) continue;
        let list = byHole.get(id);
        if (!list) { list = []; byHole.set(id, list); }
        list.push(i);
    }
    const holes: HoleInfo[] = [];
    for (const [id, list] of byHole) {
        if (depth) {
            // Samples without a depth go last, in the order they are stored
            const key = (i: number) => (Number.isFinite(depth[i]) ? depth[i] : Infinity);
            list.sort((a, b) => key(a) - key(b) || a - b);
        }
        const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
        let depthFrom: number | null = null, depthTo: number | null = null;
        for (const i of list) {
            for (let k = 0; k < 3; k++) {
                const v = positions[i * 3 + k];
                if (v < min[k]) min[k] = v;
                if (v > max[k]) max[k] = v;
            }
            if (depth && Number.isFinite(depth[i])) {
                if (depthFrom === null || depth[i] < depthFrom) depthFrom = depth[i];
                const end = to && Number.isFinite(to[i]) ? Math.max(to[i], depth[i]) : depth[i];
                if (depthTo === null || end > depthTo) depthTo = end;
            }
        }
        holes.push({ id, rows: Uint32Array.from(list), min, max, depthFrom, depthTo });
    }
    holes.sort((a, b) => naturalCompare(a.id, b.id));
    const holeOfRow = new Int32Array(n).fill(-1);
    holes.forEach((h, k) => { for (const i of h.rows) holeOfRow[i] = k; });
    return { holes, holeOfRow };
}

/** Letters and digits only, lower case: "DH-012 a" and "dh012A" are the same to a search. */
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** The last number in an ID without its leading zeros ("RC-0012A" -> "12"); '' when there is none. */
const lastNumber = (s: string) => {
    const all = s.match(/\d+/g);
    return all ? all[all.length - 1].replace(/^0+(?=\d)/, '') : '';
};

/**
 * Holes matching what was typed, best first: the ID itself, then IDs whose
 * number is the one typed ("12" finds DH012 before DH120), then IDs starting
 * with it, then IDs containing it. Case, spaces and punctuation are ignored.
 * An empty search gives every hole.
 */
export function searchHoles(holes: HoleInfo[], query: string): HoleInfo[] {
    const q = plain(query);
    if (!q) return holes;
    const number = /^\d+$/.test(q) ? q.replace(/^0+(?=\d)/, '') : null;
    const ranked: [number, HoleInfo][] = [];
    for (const h of holes) {
        const id = plain(h.id);
        const at = id.indexOf(q);
        let rank = -1;
        if (id === q) rank = 0;
        else if (number !== null && lastNumber(h.id) === number) rank = 1;
        else if (at === 0) rank = 2;
        else if (at > 0) rank = 3;
        if (rank >= 0) ranked.push([rank, h]);
    }
    // `holes` is already in natural order, and the sort is stable
    return ranked.sort((a, b) => a[0] - b[0]).map(r => r[1]);
}

/**
 * The hole as a line through its samples (flat xyz list, local coordinates),
 * from the top of its first sample to the bottom of its last when the samples
 * have intervals (`start` / `end` / `has`: see intervals.ts).
 *
 * With the hole's own path (`known`: its trace and the world place of the
 * view's local origin) the line follows that instead, from the collar to the
 * bottom of the last sample (to the last survey station when the samples have
 * no depths).
 */
export function holePath(
    hole: HoleInfo,
    positions: ArrayLike<number>,
    intervals: { start: ArrayLike<number>; end: ArrayLike<number>; has: ArrayLike<number> } | null,
    known: { trace: HoleTrace; origin: ArrayLike<number> } | null = null,
): number[] {
    const path: number[] = [];
    if (known) {
        const { trace, origin } = known;
        const end = hole.depthTo ?? trace.depths[trace.depths.length - 1];
        for (const p of tracePolyline(trace, end).points) path.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
        return path;
    }
    const rows = hole.rows;
    if (rows.length === 0) return path;
    const first = rows[0], last = rows[rows.length - 1];
    if (intervals?.has[first]) path.push(intervals.start[first * 3], intervals.start[first * 3 + 1], intervals.start[first * 3 + 2]);
    for (const i of rows) path.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    if (intervals?.has[last]) path.push(intervals.end[last * 3], intervals.end[last * 3 + 1], intervals.end[last * 3 + 2]);
    return path;
}

/** "0 – 250 m" (or "from 12 m" / a sample count) for a hole in the list. */
export function holeSummary(hole: HoleInfo): string {
    const fmt = (v: number) => String(Number(v.toFixed(1)));
    if (hole.depthFrom !== null && hole.depthTo !== null && hole.depthTo > hole.depthFrom) return `${fmt(hole.depthFrom)} – ${fmt(hole.depthTo)} m`;
    return `${hole.rows.length.toLocaleString()} sample${hole.rows.length === 1 ? '' : 's'}`;
}
