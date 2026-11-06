/**
 * Shared eigendecomposition — the single eigen solver for the app (Phase 8).
 *
 * Leaf module with no imports so both pcaAnalysis.ts and logratioTransforms.ts
 * can use it without a circular dependency. Replaced the nondeterministic
 * power-iteration copies (random init made biplot signs vary between runs).
 */

/**
 * Jacobi eigendecomposition for symmetric matrices
 *
 * Uses Givens rotations to iteratively eliminate off-diagonal elements.
 * Returns ALL eigenvalues and eigenvectors sorted by magnitude (descending).
 *
 * This is more accurate than power iteration for extracting all components.
 */
export function jacobiEigendecomposition(matrix: number[][]): {
  eigenvalues: number[];
  eigenvectors: number[][];
} {
  const n = matrix.length;
  if (n === 0) return { eigenvalues: [], eigenvectors: [] };

  // Deep copy the matrix
  const A: number[][] = matrix.map(row => [...row]);

  // Initialize eigenvector matrix as identity
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  const maxIterations = 50 * n * n; // Increased for larger matrices
  const tolerance = 1e-12;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0;
    let p = 0;
    let q = 1;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const absVal = Math.abs(A[i][j]);
        if (absVal > maxVal) {
          maxVal = absVal;
          p = i;
          q = j;
        }
      }
    }

    // Check for convergence
    if (maxVal < tolerance) break;

    // Calculate rotation angle using stable formula
    const diff = A[q][q] - A[p][p];
    let t: number;

    if (Math.abs(A[p][q]) < Math.abs(diff) * 1e-36) {
      t = A[p][q] / diff;
    } else {
      const phi = diff / (2 * A[p][q]);
      t = 1 / (Math.abs(phi) + Math.sqrt(phi * phi + 1));
      if (phi < 0) t = -t;
    }

    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;
    const tau = s / (1 + c);

    // Apply rotation to A
    const App = A[p][p];
    const Aqq = A[q][q];

    A[p][p] = App - t * A[p][q];
    A[q][q] = Aqq + t * A[p][q];
    A[p][q] = 0;
    A[q][p] = 0;

    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const Aip = A[i][p];
        const Aiq = A[i][q];
        A[i][p] = Aip - s * (Aiq + tau * Aip);
        A[p][i] = A[i][p];
        A[i][q] = Aiq + s * (Aip - tau * Aiq);
        A[q][i] = A[i][q];
      }

      // Update eigenvector matrix
      const Vip = V[i][p];
      const Viq = V[i][q];
      V[i][p] = Vip - s * (Viq + tau * Vip);
      V[i][q] = Viq + s * (Vip - tau * Viq);
    }
  }

  // Extract eigenvalues from diagonal
  const eigenvalues = A.map((row, i) => row[i]);

  // Create array of indices sorted by eigenvalue (descending)
  const indices = eigenvalues.map((_, i) => i)
    .sort((a, b) => eigenvalues[b] - eigenvalues[a]);

  // Sort eigenvalues
  const sortedEigenvalues = indices.map(i => eigenvalues[i]);

  // Extract and sort eigenvectors (each column of V is an eigenvector)
  // Transpose so each row is an eigenvector
  const sortedEigenvectors: number[][] = indices.map(i =>
    V.map(row => row[i])
  );

  return {
    eigenvalues: sortedEigenvalues,
    eigenvectors: sortedEigenvectors
  };
}

/**
 * Deterministic 2-component PCA on raw (covariance) data — for quick 2D
 * projections like the clustering scatter. Replaces the nondeterministic
 * inline power-iteration copy that lived in ClusteringAnalysis.
 */
export function pca2d(matrix: number[][]): { pc1: number[]; pc2: number[]; explained: [number, number] } {
  const n = matrix.length;
  if (n === 0) return { pc1: [], pc2: [], explained: [0, 0] };
  const p = matrix[0].length;

  // Center data
  const means = new Array(p).fill(0);
  for (const row of matrix) for (let j = 0; j < p; j++) means[j] += row[j];
  for (let j = 0; j < p; j++) means[j] /= n;
  const centered = matrix.map(row => row.map((v, j) => v - means[j]));

  // Covariance matrix
  const cov: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += centered[k][i] * centered[k][j];
      cov[i][j] = sum / (n - 1);
      cov[j][i] = cov[i][j];
    }
  }

  const { eigenvalues, eigenvectors } = jacobiEigendecomposition(cov);
  const e1 = eigenvectors[0] ?? new Array(p).fill(0);
  const e2 = eigenvectors[1] ?? new Array(p).fill(0);

  const totalVar = cov.reduce((s, row, i) => s + row[i], 0);
  const explained: [number, number] = totalVar > 0
    ? [Math.max(0, eigenvalues[0] ?? 0) / totalVar * 100, Math.max(0, eigenvalues[1] ?? 0) / totalVar * 100]
    : [0, 0];

  const pc1 = centered.map(row => row.reduce((s, v, j) => s + v * e1[j], 0));
  const pc2 = centered.map(row => row.reduce((s, v, j) => s + v * e2[j], 0));

  return { pc1, pc2, explained };
}
