/**
 * Enhanced Clustering Methods
 * K-Means, Hierarchical, and Amalgamation Clustering
 * Based on GeoCoDA methodology for compositional data
 */

import {
    ClusteringMethod,
    HierarchicalLinkage,
    DistanceMetric,
    EnhancedClusteringConfig,
    EnhancedClusteringResult,
    ClusterStatistics,
    ClusterDendrogramNode,
    AmalgamationClusteringConfig,
    AmalgamationClusteringResult,
    ElementClusterNode,
} from '../../types/statistics';

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]): number {
    if (values.length <= 1) return 0;
    const m = mean(values);
    const variance = values.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function geometricMean(values: number[]): number {
    if (values.length === 0) return 0;
    const product = values.reduce((p, v) => p * Math.max(v, 1e-10), 1);
    return Math.pow(product, 1 / values.length);
}

// =============================================================================
// DATA TRANSFORMATION
// =============================================================================

/**
 * Apply CLR (Centered Log-Ratio) transformation
 */
function applyCLR(row: number[]): number[] {
    const geoMean = geometricMean(row);
    return row.map(v => Math.log(Math.max(v, 1e-10) / geoMean));
}

/**
 * Apply ALR (Additive Log-Ratio) transformation
 */
function applyALR(row: number[], referenceIndex: number): number[] {
    const ref = Math.max(row[referenceIndex], 1e-10);
    return row
        .filter((_, i) => i !== referenceIndex)
        .map(v => Math.log(Math.max(v, 1e-10) / ref));
}

/**
 * Apply Z-score standardization
 */
function applyZScore(matrix: number[][], means: number[], stds: number[]): number[][] {
    return matrix.map(row =>
        row.map((v, j) => (stds[j] > 0 ? (v - means[j]) / stds[j] : 0))
    );
}

// =============================================================================
// DISTANCE METRICS
// =============================================================================

function euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
}

function manhattanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += Math.abs(a[i] - b[i]);
    }
    return sum;
}

function correlationDistance(a: number[], b: number[]): number {
    const meanA = mean(a);
    const meanB = mean(b);
    let cov = 0, varA = 0, varB = 0;

    for (let i = 0; i < a.length; i++) {
        const dA = a[i] - meanA;
        const dB = b[i] - meanB;
        cov += dA * dB;
        varA += dA * dA;
        varB += dB * dB;
    }

    const corr = (varA > 0 && varB > 0) ? cov / Math.sqrt(varA * varB) : 0;
    return 1 - corr;
}

function cosineDistance(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const sim = (normA > 0 && normB > 0) ? dot / Math.sqrt(normA * normB) : 0;
    return 1 - sim;
}

function calculateDistance(a: number[], b: number[], metric: DistanceMetric): number {
    switch (metric) {
        case 'manhattan':
            return manhattanDistance(a, b);
        case 'correlation':
            return correlationDistance(a, b);
        case 'cosine':
            return cosineDistance(a, b);
        case 'logratio':
            // For logratio distance, data should already be CLR transformed
            return euclideanDistance(a, b);
        case 'euclidean':
        default:
            return euclideanDistance(a, b);
    }
}

// =============================================================================
// K-MEANS CLUSTERING
// =============================================================================

interface KMeansResult {
    assignments: number[];
    centers: number[][];
    inertia: number;
    iterations: number;
}

function kMeans(
    data: number[][],
    k: number,
    maxIter: number = 100,
    nInit: number = 10,
    metric: DistanceMetric = 'euclidean'
): KMeansResult {
    const n = data.length;
    const d = data[0]?.length || 0;

    if (n < k || d === 0) {
        return {
            assignments: new Array(n).fill(0),
            centers: [],
            inertia: Infinity,
            iterations: 0,
        };
    }

    let bestResult: KMeansResult = {
        assignments: [],
        centers: [],
        inertia: Infinity,
        iterations: 0,
    };

    // Multiple initializations
    for (let init = 0; init < nInit; init++) {
        // K-means++ initialization
        const centers = kMeansPlusPlusInit(data, k, metric);
        let assignments = new Array(n).fill(0);
        let prevInertia = Infinity;

        for (let iter = 0; iter < maxIter; iter++) {
            // Assignment step
            let inertia = 0;
            for (let i = 0; i < n; i++) {
                let minDist = Infinity;
                for (let j = 0; j < k; j++) {
                    const dist = calculateDistance(data[i], centers[j], metric);
                    if (dist < minDist) {
                        minDist = dist;
                        assignments[i] = j;
                    }
                }
                inertia += minDist * minDist;
            }

            // Check convergence
            if (Math.abs(prevInertia - inertia) < 1e-6) {
                if (inertia < bestResult.inertia) {
                    bestResult = { assignments: [...assignments], centers: centers.map(c => [...c]), inertia, iterations: iter + 1 };
                }
                break;
            }
            prevInertia = inertia;

            // Update step
            const counts = new Array(k).fill(0);
            const newCenters = centers.map(() => new Array(d).fill(0));

            for (let i = 0; i < n; i++) {
                const cluster = assignments[i];
                counts[cluster]++;
                for (let j = 0; j < d; j++) {
                    newCenters[cluster][j] += data[i][j];
                }
            }

            for (let j = 0; j < k; j++) {
                if (counts[j] > 0) {
                    for (let l = 0; l < d; l++) {
                        centers[j][l] = newCenters[j][l] / counts[j];
                    }
                }
            }

            if (iter === maxIter - 1 && inertia < bestResult.inertia) {
                bestResult = { assignments: [...assignments], centers: centers.map(c => [...c]), inertia, iterations: iter + 1 };
            }
        }
    }

    return bestResult;
}

function kMeansPlusPlusInit(data: number[][], k: number, metric: DistanceMetric): number[][] {
    const n = data.length;
    const centers: number[][] = [];

    // First center: random
    centers.push([...data[Math.floor(Math.random() * n)]]);

    // Subsequent centers: weighted by distance squared
    for (let c = 1; c < k; c++) {
        const distances = data.map(point => {
            let minDist = Infinity;
            for (const center of centers) {
                const dist = calculateDistance(point, center, metric);
                if (dist < minDist) minDist = dist;
            }
            return minDist * minDist;
        });

        const totalDist = distances.reduce((a, b) => a + b, 0);
        if (totalDist === 0) {
            centers.push([...data[Math.floor(Math.random() * n)]]);
            continue;
        }

        const threshold = Math.random() * totalDist;
        let cumulative = 0;
        for (let i = 0; i < n; i++) {
            cumulative += distances[i];
            if (cumulative >= threshold) {
                centers.push([...data[i]]);
                break;
            }
        }
    }

    return centers;
}

// =============================================================================
// HIERARCHICAL CLUSTERING
// =============================================================================

interface HierarchicalNode {
    id: number;
    left: HierarchicalNode | null;
    right: HierarchicalNode | null;
    height: number;
    indices: number[];
}

function hierarchicalClustering(
    data: number[][],
    linkage: HierarchicalLinkage = 'ward',
    metric: DistanceMetric = 'euclidean'
): HierarchicalNode {
    const n = data.length;

    // Initialize nodes (each point is a cluster)
    const nodes: HierarchicalNode[] = data.map((_, i) => ({
        id: i,
        left: null,
        right: null,
        height: 0,
        indices: [i],
    }));

    // Distance matrix
    const distMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const dist = calculateDistance(data[i], data[j], metric);
            distMatrix[i][j] = dist;
            distMatrix[j][i] = dist;
        }
    }

    // Active clusters
    let activeClusters = [...nodes];
    let nextId = n;

    while (activeClusters.length > 1) {
        // Find closest pair
        let minDist = Infinity;
        let minI = 0;
        let minJ = 1;

        for (let i = 0; i < activeClusters.length; i++) {
            for (let j = i + 1; j < activeClusters.length; j++) {
                const dist = calculateLinkageDistance(
                    activeClusters[i],
                    activeClusters[j],
                    data,
                    distMatrix,
                    linkage,
                    metric
                );
                if (dist < minDist) {
                    minDist = dist;
                    minI = i;
                    minJ = j;
                }
            }
        }

        // Merge clusters
        const newNode: HierarchicalNode = {
            id: nextId++,
            left: activeClusters[minI],
            right: activeClusters[minJ],
            height: minDist,
            indices: [...activeClusters[minI].indices, ...activeClusters[minJ].indices],
        };

        // Update active clusters
        activeClusters = activeClusters.filter((_, idx) => idx !== minI && idx !== minJ);
        activeClusters.push(newNode);
    }

    return activeClusters[0];
}

function calculateLinkageDistance(
    cluster1: HierarchicalNode,
    cluster2: HierarchicalNode,
    data: number[][],
    distMatrix: number[][],
    linkage: HierarchicalLinkage,
    metric: DistanceMetric
): number {
    const indices1 = cluster1.indices;
    const indices2 = cluster2.indices;

    switch (linkage) {
        case 'single':
            let minDist = Infinity;
            for (const i of indices1) {
                for (const j of indices2) {
                    if (distMatrix[i][j] < minDist) {
                        minDist = distMatrix[i][j];
                    }
                }
            }
            return minDist;

        case 'complete':
            let maxDist = 0;
            for (const i of indices1) {
                for (const j of indices2) {
                    if (distMatrix[i][j] > maxDist) {
                        maxDist = distMatrix[i][j];
                    }
                }
            }
            return maxDist;

        case 'average':
            let sumDist = 0;
            for (const i of indices1) {
                for (const j of indices2) {
                    sumDist += distMatrix[i][j];
                }
            }
            return sumDist / (indices1.length * indices2.length);

        case 'ward':
            // Ward's method: minimize within-cluster variance
            const centroid1 = calculateCentroid(indices1.map(i => data[i]));
            const centroid2 = calculateCentroid(indices2.map(i => data[i]));

            const n1 = indices1.length;
            const n2 = indices2.length;

            // Ward's increase in total within-cluster sum of squares
            const d = calculateDistance(centroid1, centroid2, metric);
            return Math.sqrt((2 * n1 * n2) / (n1 + n2)) * d;

        default:
            return 0;
    }
}

function calculateCentroid(points: number[][]): number[] {
    if (points.length === 0) return [];
    const d = points[0].length;
    const centroid = new Array(d).fill(0);

    for (const point of points) {
        for (let i = 0; i < d; i++) {
            centroid[i] += point[i];
        }
    }

    return centroid.map(v => v / points.length);
}

function convertToDendrogram(node: HierarchicalNode): ClusterDendrogramNode {
    return {
        id: String(node.id),
        left: node.left ? convertToDendrogram(node.left) : undefined,
        right: node.right ? convertToDendrogram(node.right) : undefined,
        height: node.height,
        indices: node.indices,
        count: node.indices.length,
    };
}

function cutDendrogram(node: HierarchicalNode, k: number): number[] {
    // Cut dendrogram to get k clusters
    const n = node.indices.length;
    const assignments = new Array(n).fill(0);

    // Find k-1 highest merge heights and cut there
    const mergeHeights: { node: HierarchicalNode; height: number }[] = [];

    function collectMerges(n: HierarchicalNode) {
        if (n.left && n.right) {
            mergeHeights.push({ node: n, height: n.height });
            collectMerges(n.left);
            collectMerges(n.right);
        }
    }
    collectMerges(node);

    mergeHeights.sort((a, b) => b.height - a.height);
    const cutHeight = k > 1 && mergeHeights.length >= k - 1 ? mergeHeights[k - 2].height : 0;

    // Assign clusters
    let clusterId = 0;
    function assignClusters(n: HierarchicalNode, currentCluster: number) {
        if (!n.left || !n.right || n.height <= cutHeight) {
            for (const idx of n.indices) {
                assignments[idx] = currentCluster;
            }
        } else {
            assignClusters(n.left, clusterId++);
            assignClusters(n.right, clusterId++);
        }
    }
    assignClusters(node, clusterId++);

    // Renumber clusters to be sequential from 0
    const uniqueClusters = [...new Set(assignments)].sort((a, b) => a - b);
    const clusterMap = new Map(uniqueClusters.map((c, i) => [c, i]));
    return assignments.map(a => clusterMap.get(a) || 0);
}

// =============================================================================
// SILHOUETTE SCORE
// =============================================================================

function calculateSilhouetteScores(
    data: number[][],
    assignments: number[],
    metric: DistanceMetric = 'euclidean'
): number[] {
    const n = data.length;
    const k = Math.max(...assignments) + 1;
    const silhouettes = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
        const cluster = assignments[i];

        // a(i): average distance to points in same cluster
        const sameCluster = data.filter((_, j) => assignments[j] === cluster && j !== i);
        const a = sameCluster.length > 0
            ? mean(sameCluster.map(p => calculateDistance(data[i], p, metric)))
            : 0;

        // b(i): minimum average distance to points in other clusters
        let b = Infinity;
        for (let c = 0; c < k; c++) {
            if (c === cluster) continue;
            const otherCluster = data.filter((_, j) => assignments[j] === c);
            if (otherCluster.length > 0) {
                const avgDist = mean(otherCluster.map(p => calculateDistance(data[i], p, metric)));
                if (avgDist < b) b = avgDist;
            }
        }

        if (b === Infinity) b = a;

        silhouettes[i] = (a === 0 && b === 0) ? 0 : (b - a) / Math.max(a, b);
    }

    return silhouettes;
}

// =============================================================================
// MAIN CLUSTERING FUNCTION
// =============================================================================

/**
 * Perform clustering with specified method
 */
export function performClustering(
    data: Record<string, any>[],
    config: EnhancedClusteringConfig
): EnhancedClusteringResult {
    const {
        method,
        columns,
        k,
        kRange,
        transformationType = 'none',
        alrReference,
        linkage = 'ward',
        distanceMetric = 'euclidean',
        calculateSilhouette = true,
        nInitializations = 10,
        maxIterations = 100,
    } = config;

    // Extract and validate data
    const matrix: number[][] = [];
    const validIndices: number[] = [];

    for (let i = 0; i < data.length; i++) {
        const row: number[] = [];
        let valid = true;

        for (const col of columns) {
            const val = parseFloat(data[i][col]);
            if (isNaN(val) || !isFinite(val)) {
                valid = false;
                break;
            }
            row.push(val);
        }

        if (valid) {
            matrix.push(row);
            validIndices.push(i);
        }
    }

    if (matrix.length < 2) {
        return createEmptyClusterResult(method, data.length);
    }

    // Apply transformation
    let transformedData: number[][] = matrix;

    if (transformationType === 'clr') {
        transformedData = matrix.map(applyCLR);
    } else if (transformationType === 'alr' && alrReference) {
        const refIdx = columns.indexOf(alrReference);
        if (refIdx >= 0) {
            transformedData = matrix.map(row => applyALR(row, refIdx));
        }
    } else if (transformationType === 'zscore') {
        const colMeans = columns.map((_, j) => mean(matrix.map(row => row[j])));
        const colStds = columns.map((_, j) => std(matrix.map(row => row[j])));
        transformedData = applyZScore(matrix, colMeans, colStds);
    }

    // Determine k if automatic selection needed
    let finalK = k || 3;
    let elbowData: { k: number; inertia: number; silhouette?: number }[] | undefined;

    if (kRange && !k) {
        const [minK, maxK] = kRange;
        elbowData = [];

        for (let testK = minK; testK <= maxK; testK++) {
            const result = kMeans(transformedData, testK, maxIterations, nInitializations, distanceMetric);
            const silhouettes = calculateSilhouette
                ? calculateSilhouetteScores(transformedData, result.assignments, distanceMetric)
                : [];

            elbowData.push({
                k: testK,
                inertia: result.inertia,
                silhouette: silhouettes.length > 0 ? mean(silhouettes) : undefined,
            });
        }

        // Find optimal k using elbow method (maximum second derivative)
        if (elbowData.length >= 3) {
            const inertias = elbowData.map(d => d.inertia);
            let maxSecondDerivative = 0;
            let optimalIdx = 0;

            for (let i = 1; i < inertias.length - 1; i++) {
                const secondDerivative = inertias[i - 1] - 2 * inertias[i] + inertias[i + 1];
                if (secondDerivative > maxSecondDerivative) {
                    maxSecondDerivative = secondDerivative;
                    optimalIdx = i;
                }
            }

            finalK = elbowData[optimalIdx].k;
        }
    }

    // Perform clustering
    let assignments: number[];
    let centers: number[][] | undefined;
    let dendrogram: ClusterDendrogramNode | undefined;

    switch (method) {
        case 'hierarchical':
            const root = hierarchicalClustering(transformedData, linkage, distanceMetric);
            assignments = cutDendrogram(root, finalK);
            dendrogram = convertToDendrogram(root);
            break;

        case 'kmeans':
        default:
            const kmeansResult = kMeans(transformedData, finalK, maxIterations, nInitializations, distanceMetric);
            assignments = kmeansResult.assignments;
            centers = kmeansResult.centers;
            break;
    }

    // Map back to original indices
    const assignmentsFull: (number | null)[] = new Array(data.length).fill(null);
    for (let i = 0; i < validIndices.length; i++) {
        assignmentsFull[validIndices[i]] = assignments[i];
    }

    // Calculate cluster statistics
    const clusterStats = calculateClusterStatistics(data, columns, assignmentsFull, finalK);

    // Calculate quality metrics
    let silhouetteScores: number[] | undefined;
    let avgSilhouette: number | undefined;

    if (calculateSilhouette) {
        silhouetteScores = calculateSilhouetteScores(transformedData, assignments, distanceMetric);
        avgSilhouette = mean(silhouetteScores);
    }

    // Calculate BSS/TSS
    let withinClusterSS = 0;
    let totalSS = 0;
    const globalCentroid = calculateCentroid(transformedData);

    for (let i = 0; i < transformedData.length; i++) {
        const cluster = assignments[i];
        const clusterPoints = transformedData.filter((_, j) => assignments[j] === cluster);
        const clusterCentroid = calculateCentroid(clusterPoints);

        for (let j = 0; j < transformedData[i].length; j++) {
            withinClusterSS += Math.pow(transformedData[i][j] - clusterCentroid[j], 2);
            totalSS += Math.pow(transformedData[i][j] - globalCentroid[j], 2);
        }
    }

    const betweenClusterSS = totalSS - withinClusterSS;
    const bssOverTss = totalSS > 0 ? betweenClusterSS / totalSS : 0;

    return {
        method,
        k: finalK,
        assignments: assignmentsFull,
        centers,
        withinClusterSS,
        betweenClusterSS,
        totalSS,
        bssOverTss,
        silhouetteScores,
        avgSilhouette,
        clusterStats,
        dendrogram,
        elbowData,
        optimalK: kRange && !k ? finalK : undefined,
    };
}

function calculateClusterStatistics(
    data: Record<string, any>[],
    columns: string[],
    assignments: (number | null)[],
    k: number
): ClusterStatistics[] {
    const stats: ClusterStatistics[] = [];
    const n = assignments.filter(a => a !== null).length;

    for (let clusterId = 0; clusterId < k; clusterId++) {
        const clusterIndices = assignments
            .map((a, i) => a === clusterId ? i : -1)
            .filter(i => i >= 0);

        const count = clusterIndices.length;
        const proportion = n > 0 ? count / n : 0;

        const meanByColumn: Record<string, number> = {};
        const stdByColumn: Record<string, number> = {};
        const centroid: Record<string, number> = {};

        for (const col of columns) {
            const values = clusterIndices
                .map(i => parseFloat(data[i][col]))
                .filter(v => !isNaN(v) && isFinite(v));

            meanByColumn[col] = values.length > 0 ? mean(values) : 0;
            stdByColumn[col] = values.length > 1 ? std(values) : 0;
            centroid[col] = meanByColumn[col];
        }

        stats.push({
            clusterId,
            count,
            proportion,
            centroid,
            meanByColumn,
            stdByColumn,
        });
    }

    return stats;
}

function createEmptyClusterResult(method: ClusteringMethod, n: number): EnhancedClusteringResult {
    return {
        method,
        k: 0,
        assignments: new Array(n).fill(null),
        clusterStats: [],
    };
}

// =============================================================================
// AMALGAMATION CLUSTERING (Element Grouping from GeoCoDA)
// =============================================================================

/**
 * Cluster elements based on logratio variance
 * Groups elements that are most similar in their behavior across samples
 */
export function performAmalgamationClustering(
    data: Record<string, any>[],
    config: AmalgamationClusteringConfig
): AmalgamationClusteringResult {
    const { elements, method: _method = 'variance-explained' } = config;
    void _method; // Reserved for alternative amalgamation methods

    // Extract element data
    const matrix: number[][] = [];
    for (let i = 0; i < data.length; i++) {
        const row: number[] = [];
        let valid = true;

        for (const elem of elements) {
            const val = parseFloat(data[i][elem]);
            if (isNaN(val) || val <= 0) {
                valid = false;
                break;
            }
            row.push(val);
        }

        if (valid) {
            matrix.push(row);
        }
    }

    if (matrix.length < 3) {
        return {
            dendrogram: { elements, height: 0 },
            elements,
            suggestedAmalgamations: [],
            varianceMatrix: [],
        };
    }

    // Calculate pairwise logratio variance matrix
    const n = elements.length;
    const varianceMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            // Calculate variance of log(elem_i / elem_j)
            const logratios = matrix.map(row =>
                Math.log(row[i] / row[j])
            );
            const variance = std(logratios) ** 2;
            varianceMatrix[i][j] = variance;
            varianceMatrix[j][i] = variance;
        }
    }

    // Hierarchical clustering of elements based on logratio variance
    const dendrogram = clusterElements(elements, varianceMatrix);

    // Generate suggested amalgamations
    const suggestedAmalgamations = generateAmalgamationSuggestions(dendrogram, varianceMatrix, elements);

    return {
        dendrogram,
        elements,
        suggestedAmalgamations,
        varianceMatrix,
    };
}

function clusterElements(
    elements: string[],
    varianceMatrix: number[][]
): ElementClusterNode {
    // Initialize nodes
    interface WorkNode {
        elements: string[];
        indices: number[];
        height: number;
    }

    let nodes: WorkNode[] = elements.map((elem, i) => ({
        elements: [elem],
        indices: [i],
        height: 0,
    }));

    // Distance matrix (copy of variance matrix)
    const distMatrix: number[][] = varianceMatrix.map(row => [...row]);

    while (nodes.length > 1) {
        // Find closest pair (minimum variance when amalgamated)
        let minDist = Infinity;
        let minI = 0;
        let minJ = 1;

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                // Average linkage on variance
                let sumVar = 0;
                let count = 0;
                for (const idx1 of nodes[i].indices) {
                    for (const idx2 of nodes[j].indices) {
                        sumVar += distMatrix[idx1][idx2];
                        count++;
                    }
                }
                const avgVar = count > 0 ? sumVar / count : 0;

                if (avgVar < minDist) {
                    minDist = avgVar;
                    minI = i;
                    minJ = j;
                }
            }
        }

        // Merge nodes
        const newNode: WorkNode = {
            elements: [...nodes[minI].elements, ...nodes[minJ].elements],
            indices: [...nodes[minI].indices, ...nodes[minJ].indices],
            height: minDist,
        };

        nodes = nodes.filter((_, idx) => idx !== minI && idx !== minJ);
        nodes.push(newNode);
    }

    // Convert to ElementClusterNode tree
    function buildTree(workNodes: WorkNode[], _elements: string[]): ElementClusterNode {
        void _elements; // Kept for potential future use in tree building
        if (workNodes.length === 0) {
            return { elements: [], height: 0 };
        }

        const node = workNodes[0];
        if (node.elements.length === 1) {
            return {
                element: node.elements[0],
                elements: node.elements,
                height: 0,
            };
        }

        // This is a simplified tree structure
        return {
            elements: node.elements,
            height: node.height,
        };
    }

    return buildTree(nodes, elements);
}

function generateAmalgamationSuggestions(
    _dendrogram: ElementClusterNode,
    varianceMatrix: number[][],
    elements: string[]
): AmalgamationClusteringResult['suggestedAmalgamations'] {
    void _dendrogram; // Reserved for dendrogram-based suggestions
    const suggestions: AmalgamationClusteringResult['suggestedAmalgamations'] = [];

    // Predefined geochemical amalgamations with interpretations
    const knownGroups: { name: string; elements: string[]; interpretation: string }[] = [
        { name: 'LREE', elements: ['La', 'Ce', 'Pr', 'Nd'], interpretation: 'Light Rare Earth Elements' },
        { name: 'HREE', elements: ['Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'], interpretation: 'Heavy Rare Earth Elements' },
        { name: 'Felsic', elements: ['Si', 'SiO2', 'Na', 'Na2O', 'K', 'K2O', 'Al', 'Al2O3'], interpretation: 'Felsic affinity elements' },
        { name: 'Mafic', elements: ['Fe', 'FeO', 'Fe2O3', 'Mg', 'MgO', 'Ca', 'CaO', 'Ti', 'TiO2'], interpretation: 'Mafic affinity elements' },
        { name: 'Mantle', elements: ['Si', 'Mg', 'Fe', 'Cr', 'Co', 'Ni', 'Ti'], interpretation: 'Mantle-derived elements' },
        { name: 'Crustal', elements: ['Al', 'Rb', 'Na', 'K', 'Ga'], interpretation: 'Crustal affinity elements' },
        { name: 'Chalcophile', elements: ['Cu', 'Zn', 'Pb', 'Ag', 'As', 'Sb', 'Bi'], interpretation: 'Sulfide-associated elements' },
        { name: 'Siderophile', elements: ['Fe', 'Co', 'Ni', 'Pt', 'Pd'], interpretation: 'Iron-associated elements' },
    ];

    for (const group of knownGroups) {
        const presentElements = group.elements.filter(e =>
            elements.some(el => el.toLowerCase() === e.toLowerCase())
        );

        if (presentElements.length >= 2) {
            // Calculate average variance within group
            let totalVar = 0;
            let count = 0;
            for (let i = 0; i < presentElements.length; i++) {
                for (let j = i + 1; j < presentElements.length; j++) {
                    const idx1 = elements.findIndex(e => e.toLowerCase() === presentElements[i].toLowerCase());
                    const idx2 = elements.findIndex(e => e.toLowerCase() === presentElements[j].toLowerCase());
                    if (idx1 >= 0 && idx2 >= 0) {
                        totalVar += varianceMatrix[idx1][idx2];
                        count++;
                    }
                }
            }

            const avgVar = count > 0 ? totalVar / count : 0;

            suggestions.push({
                name: group.name,
                elements: presentElements,
                varianceExplained: 1 / (1 + avgVar), // Convert variance to similarity score
                interpretation: group.interpretation,
            });
        }
    }

    // Sort by variance explained (similarity)
    suggestions.sort((a, b) => b.varianceExplained - a.varianceExplained);

    return suggestions;
}

// =============================================================================
// CROSS-TABULATION WITH KNOWN GROUPS
// =============================================================================

/**
 * Calculate cross-tabulation between cluster assignments and known groups
 */
export function calculateCrossTabulation(
    assignments: (number | null)[],
    knownGroups: (string | null)[],
    k: number
): EnhancedClusteringResult['crossTabulation'] {
    // Get unique group labels
    const uniqueGroups = [...new Set(knownGroups.filter(g => g !== null))] as string[];
    uniqueGroups.sort();

    // Build cross-tabulation matrix
    const matrix: number[][] = Array.from({ length: k }, () => new Array(uniqueGroups.length).fill(0));

    let total = 0;
    let correct = 0;

    for (let i = 0; i < assignments.length; i++) {
        const cluster = assignments[i];
        const group = knownGroups[i];

        if (cluster !== null && group !== null) {
            const groupIdx = uniqueGroups.indexOf(group);
            if (groupIdx >= 0) {
                matrix[cluster][groupIdx]++;
                total++;
            }
        }
    }

    // Calculate accuracy (assuming majority class assignment)
    for (let c = 0; c < k; c++) {
        const maxInCluster = Math.max(...matrix[c]);
        correct += maxInCluster;
    }

    const accuracy = total > 0 ? correct / total : 0;

    return {
        groupColumn: 'known_group',
        matrix,
        rowLabels: Array.from({ length: k }, (_, i) => `Cluster ${i}`),
        colLabels: uniqueGroups,
        accuracy,
    };
}
