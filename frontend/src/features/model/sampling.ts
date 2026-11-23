/**
 * Thinning a cloud of points to a number a surface can be fitted through
 * quickly (pure, unit-tested).
 */

/**
 * At most `max` points standing for `points` (xyz triples): space is cut into
 * equal boxes and the points in each box are replaced by their average, with
 * the boxes as small as the limit allows. Clusters thin out, lone points stay.
 * Fewer points than the limit come back unchanged.
 */
export function thinPoints(points: ArrayLike<number>, max: number): Float64Array {
    const n = Math.floor(points.length / 3);
    if (n <= max || max < 1) return Float64Array.from({ length: n * 3 }, (_, i) => points[i]);

    const min = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n * 3; i += 3) {
        for (let k = 0; k < 3; k++) {
            if (points[i + k] < min[k]) min[k] = points[i + k];
            if (points[i + k] > maxs[k]) maxs[k] = points[i + k];
        }
    }
    const extent = Math.max(maxs[0] - min[0], maxs[1] - min[1], maxs[2] - min[2]);
    if (!(extent > 0)) return Float64Array.from([points[0], points[1], points[2]]);

    /** The points averaged in boxes of this size */
    const group = (size: number): Float64Array => {
        const nx = Math.floor((maxs[0] - min[0]) / size) + 1, ny = Math.floor((maxs[1] - min[1]) / size) + 1;
        const sums = new Map<number, [number, number, number, number]>();
        for (let i = 0; i < n * 3; i += 3) {
            const key = Math.floor((points[i] - min[0]) / size)
                + nx * (Math.floor((points[i + 1] - min[1]) / size) + ny * Math.floor((points[i + 2] - min[2]) / size));
            const s = sums.get(key);
            if (s) { s[0] += points[i]; s[1] += points[i + 1]; s[2] += points[i + 2]; s[3]++; }
            else sums.set(key, [points[i], points[i + 1], points[i + 2], 1]);
        }
        const out = new Float64Array(sums.size * 3);
        let k = 0;
        for (const s of sums.values()) { out[k++] = s[0] / s[3]; out[k++] = s[1] / s[3]; out[k++] = s[2] / s[3]; }
        return out;
    };

    // The smallest box that keeps within the limit (searched by halving, on a log scale)
    let small = extent / 1024, large = extent * 1.001;
    let best = group(large);
    const finest = group(small);
    if (finest.length / 3 <= max) return finest;
    for (let step = 0; step < 14; step++) {
        const mid = Math.sqrt(small * large);
        const g = group(mid);
        if (g.length / 3 <= max) { best = g; large = mid; } else small = mid;
    }
    return best;
}
