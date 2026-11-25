/**
 * Dense linear solve for the surface fits (pure, unit-tested).
 *
 * LU with partial pivoting on a row-major Float64Array. The fits are small
 * saddle-point systems (a few hundred to ~1500 unknowns), where this is
 * milliseconds to a couple of seconds; larger problems are thinned or
 * partitioned before they get here.
 */

export interface LuFactors {
    /** False when a pivot vanished (the matrix is singular to working precision) */
    ok: boolean;
    /** Row order after pivoting: row i of the factors is row perm[i] of the input */
    perm: Int32Array;
}

/** Factor `a` (n x n, row-major) in place into L (unit diagonal, below) and U (on and above). */
export function luFactor(a: Float64Array, n: number): LuFactors {
    const perm = new Int32Array(n);
    for (let i = 0; i < n; i++) perm[i] = i;
    let scale = 0;
    for (let i = 0; i < a.length; i++) {
        const v = Math.abs(a[i]);
        if (v > scale) scale = v;
    }
    const tiny = scale * 1e-13;
    for (let k = 0; k < n; k++) {
        let p = k;
        let best = Math.abs(a[k * n + k]);
        for (let i = k + 1; i < n; i++) {
            const v = Math.abs(a[i * n + k]);
            if (v > best) { best = v; p = i; }
        }
        // Also catches NaN
        if (!(best > tiny)) return { ok: false, perm };
        const rowK = k * n;
        if (p !== k) {
            const rowP = p * n;
            for (let j = 0; j < n; j++) {
                const t = a[rowK + j];
                a[rowK + j] = a[rowP + j];
                a[rowP + j] = t;
            }
            const t = perm[k]; perm[k] = perm[p]; perm[p] = t;
        }
        const pivot = a[rowK + k];
        for (let i = k + 1; i < n; i++) {
            const rowI = i * n;
            const f = a[rowI + k] / pivot;
            if (f === 0) continue;
            a[rowI + k] = f;
            for (let j = k + 1; j < n; j++) a[rowI + j] -= f * a[rowK + j];
        }
    }
    return { ok: true, perm };
}

/** Solve with the factors from luFactor; `b` is left untouched. */
export function luSolve(lu: Float64Array, n: number, perm: Int32Array, b: ArrayLike<number>): Float64Array {
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = b[perm[i]];
    for (let i = 1; i < n; i++) {
        const row = i * n;
        let s = x[i];
        for (let j = 0; j < i; j++) s -= lu[row + j] * x[j];
        x[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
        const row = i * n;
        let s = x[i];
        for (let j = i + 1; j < n; j++) s -= lu[row + j] * x[j];
        x[i] = s / lu[row + i];
    }
    return x;
}

/** Solve a x = b (a is overwritten). Null when the matrix is singular. */
export function solveDense(a: Float64Array, n: number, b: ArrayLike<number>): Float64Array | null {
    const { ok, perm } = luFactor(a, n);
    if (!ok) return null;
    const x = luSolve(a, n, perm, b);
    for (let i = 0; i < n; i++) if (!Number.isFinite(x[i])) return null;
    return x;
}
