/**
 * Where each drillhole starts (pure, unit-tested): its collar, worked out
 * from its samples. A ground surface is put through them.
 *
 * A sample's coordinates are the middle of its interval. The collar is at
 * depth 0, so it is found by carrying the first sample's place back up the
 * hole by that sample's depth, along the line from the second sample to the
 * first (straight up when the hole has one sample only).
 */

/** The samples' holes, depths and places */
export interface HolePositions {
    hole: ArrayLike<string | null | undefined>;
    from: ArrayLike<number>;
    /** Null: an interval ends where the next one down the hole starts */
    to: ArrayLike<number> | null;
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
}

export interface Collars {
    /** xyz triples, one per hole */
    positions: Float64Array;
    holes: string[];
    /** The furthest any collar was carried up from its hole's first sample, m (large: that hole's top was not sampled, and its collar is less sure) */
    carried: number;
}

export function holeCollars(log: HolePositions): Collars {
    const byHole = new Map<string, number[]>();
    for (let i = 0; i < log.from.length; i++) {
        const hole = log.hole[i];
        if (!hole || !Number.isFinite(log.from[i]) || !Number.isFinite(log.x[i]) || !Number.isFinite(log.y[i]) || !Number.isFinite(log.z[i])) continue;
        const rows = byHole.get(hole);
        if (rows) rows.push(i);
        else byHole.set(hole, [i]);
    }
    const positions: number[] = [], holes: string[] = [];
    let carried = 0;
    for (const [hole, rows] of byHole) {
        rows.sort((p, q) => log.from[p] - log.from[q]);
        const i = rows[0];
        const to = log.to ? log.to[i] : NaN;
        const end = Number.isFinite(to) && to > log.from[i] ? to : rows.length > 1 && log.from[rows[1]] > log.from[i] ? log.from[rows[1]] : log.from[i];
        // How far down the hole the first sample's place is
        const depth = Math.max(0, (log.from[i] + end) / 2);
        // Up the hole: from the next sample at another place towards the first
        let up: [number, number, number] = [0, 0, 1];
        for (let k = 1; k < rows.length; k++) {
            const j = rows[k];
            const d = [log.x[i] - log.x[j], log.y[i] - log.y[j], log.z[i] - log.z[j]];
            const length = Math.hypot(d[0], d[1], d[2]);
            if (length > 0) { up = [d[0] / length, d[1] / length, d[2] / length]; break; }
        }
        positions.push(log.x[i] + up[0] * depth, log.y[i] + up[1] * depth, log.z[i] + up[2] * depth);
        holes.push(hole);
        carried = Math.max(carried, depth);
    }
    return { positions: Float64Array.from(positions), holes, carried };
}

/** How many of the nearest collars on plan a collar is checked against */
const NEIGHBOURS = 8;
/** A collar this far below the middle of its neighbours (m) or more is not on the ground */
const BELOW_M = 50;

/**
 * Collars well below the collars around them: holes drilled from underground
 * (or from a pit floor) start below the ground. Each collar is compared with
 * the middle height of its nearest collars on plan; it is left out when it is
 * more than 50 m, and more than three times their own spread, below it. Kept
 * and left-out collars, in the same order as given.
 */
export function belowNeighbours(c: Collars): { kept: Collars; left: string[] } {
    const n = c.holes.length;
    if (n < 4) return { kept: c, left: [] };
    const p = c.positions;
    const out = new Uint8Array(n);
    const median = (v: number[]) => {
        const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    for (let i = 0; i < n; i++) {
        const near: { d: number; z: number }[] = [];
        for (let j = 0; j < n; j++) {
            if (j !== i) near.push({ d: Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1]), z: p[j * 3 + 2] });
        }
        near.sort((a, b) => a.d - b.d);
        const zs = near.slice(0, NEIGHBOURS).map(q => q.z);
        const mid = median(zs);
        const spread = 1.4826 * median(zs.map(z => Math.abs(z - mid)));
        if (mid - p[i * 3 + 2] > Math.max(BELOW_M, 3 * spread)) out[i] = 1;
    }
    if (!out.some(v => v)) return { kept: c, left: [] };
    const positions: number[] = [], holes: string[] = [], left: string[] = [];
    for (let i = 0; i < n; i++) {
        if (out[i]) { left.push(c.holes[i]); continue; }
        positions.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        holes.push(c.holes[i]);
    }
    return { kept: { positions: Float64Array.from(positions), holes, carried: c.carried }, left };
}

/**
 * The level direction across a row of places (unit, z = 0), when they lie
 * along one line on plan: holes drilled on a single fence. Null when they
 * spread both ways. A ground surface through a fence runs level across it.
 */
export function acrossFence(positions: ArrayLike<number>): [number, number, number] | null {
    const n = Math.floor(positions.length / 3);
    if (n < 2) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += positions[i * 3] / n; my += positions[i * 3 + 1] / n; }
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
        const dx = positions[i * 3] - mx, dy = positions[i * 3 + 1] - my;
        sxx += dx * dx;
        syy += dy * dy;
        sxy += dx * dy;
    }
    const half = (sxx + syy) / 2, root = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
    const long = half + root, short = half - root;
    if (!(long > 0)) return null;
    // Spread across the line less than a fiftieth of the spread along it
    if (Math.sqrt(Math.max(0, short) / long) > 0.02) return null;
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return [-Math.sin(angle), Math.cos(angle), 0];
}
