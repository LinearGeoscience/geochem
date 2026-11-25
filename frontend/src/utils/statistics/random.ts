/**
 * Small deterministic random-number helpers for resampling methods
 * (permutation tests, bootstraps, k-means++ starts), so a result can be
 * repeated exactly from its seed.
 */

/** Deterministic PRNG (mulberry32): returns a function giving numbers in [0, 1) */
export function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Integer in [0, n) */
export const randomInt = (rand: () => number, n: number) => Math.floor(rand() * n);

/** Fisher-Yates shuffle of a copy */
export function shuffled<T>(values: ArrayLike<T>, rand: () => number): T[] {
    const out = Array.from(values);
    for (let i = out.length - 1; i > 0; i--) {
        const j = randomInt(rand, i + 1);
        const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
}

/** Linear-interpolation quantile (numpy / pandas default) of finite values; NaN when empty */
export function quantileLinear(values: ArrayLike<number>, q: number): number {
    const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
    if (v.length === 0) return NaN;
    const pos = (v.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

/** Median of finite values; NaN when empty */
export const medianOf = (values: ArrayLike<number>) => quantileLinear(values, 0.5);
