/**
 * Stage 5: Robust Statistical Methods & Machine Learning Types
 * Based on GeoCoDA methodology and "The Geochemical Architect" guide
 */

// =============================================================================
// ROBUST REGRESSION TYPES
// =============================================================================

export type RegressionMethod = 'ols' | 'lts' | 'bisquare' | 'huber';

export interface RobustRegressionConfig {
    method: RegressionMethod;
    xColumn: string;
    yColumn: string;
    groupColumn?: string;        // For per-category regression
    confidenceLevel: number;     // 0.95, 0.99
    trimFraction?: number;       // For LTS: fraction of data to use (0.5-1.0)
    maxIterations?: number;      // For iterative methods
    convergenceThreshold?: number;
}

export interface RegressionResult {
    method: RegressionMethod;
    slope: number;
    intercept: number;
    rSquared: number;
    standardError: number;
    residuals: (number | null)[];
    fittedValues: (number | null)[];
    confidenceInterval: {
        slope: [number, number];
        intercept: [number, number];
    };
    predictionBands: {
        lower: (number | null)[];
        upper: (number | null)[];
    };
    outlierIndices: number[];    // Indices flagged as outliers
    diagnostics: {
        n: number;
        df: number;
        mse: number;
        rmse: number;
        mae: number;
    };
}

export interface GroupedRegressionResult {
    groups: Record<string, RegressionResult>;
    globalResult?: RegressionResult;
}

// =============================================================================
// ANOMALY DETECTION TYPES
// =============================================================================

export type AnomalyMethod =
    | 'sigma'           // Mean ± nσ
    | 'mad'             // Median Absolute Deviation
    | 'iqr'             // Interquartile Range (box plot fences)
    | 'percentile'      // Percentile-based
    | 'zscore'          // Z-score threshold
    | 'robust-zscore'   // Modified Z-score using MAD
    | 'regression'      // Regression residual-based
    | 'isolation-forest'// Isolation Forest (multivariate)
    | 'mahalanobis';    // Mahalanobis distance

export interface AnomalyDetectionConfig {
    method: AnomalyMethod;
    column: string;
    additionalColumns?: string[]; // For multivariate methods

    // Method-specific parameters
    sigmaMultiplier?: number;     // For sigma method (default: 3)
    percentileLower?: number;     // For percentile method (default: 1)
    percentileUpper?: number;     // For percentile method (default: 99)
    iqrMultiplier?: number;       // For IQR method (default: 1.5)
    zscoreThreshold?: number;     // For z-score methods (default: 3)

    // Regression-based parameters
    regressionXColumn?: string;
    regressionMethod?: RegressionMethod;
    residualThreshold?: number;   // Sigma multiplier for residuals

    // Grouping
    groupColumn?: string;         // For per-group anomaly detection

    // Output options
    includeScores?: boolean;      // Return anomaly scores, not just flags
    bidirectional?: boolean;      // Detect both high and low anomalies
}

export interface AnomalyResult {
    method: AnomalyMethod;
    column: string;
    isAnomaly: boolean[];
    anomalyScores?: (number | null)[];  // Normalized anomaly strength
    thresholds: {
        lower?: number;
        upper?: number;
    };
    statistics: {
        n: number;
        nAnomalies: number;
        anomalyRate: number;
        mean?: number;
        median?: number;
        std?: number;
        mad?: number;
        q1?: number;
        q3?: number;
    };
    anomalyIndices: number[];
    groupResults?: Record<string, AnomalyResult>;
}

// =============================================================================
// POPULATION SEPARATION TYPES
// =============================================================================

export interface PopulationSeparationConfig {
    column: string;
    maxPopulations: number;       // Maximum populations to detect
    method: 'gaussian-mixture' | 'log-probability' | 'histogram-mode';
    minSeparation?: number;       // Minimum separation between population means
    useLogScale?: boolean;        // Apply log transform first
}

export interface DetectedPopulation {
    id: number;
    mean: number;
    stdDev: number;
    proportion: number;           // Fraction of total samples
    count: number;
    lowerBound: number;
    upperBound: number;
    classification: 'background' | 'anomalous' | 'threshold' | 'high-grade';
}

export interface PopulationSeparationResult {
    column: string;
    nPopulations: number;
    populations: DetectedPopulation[];
    separationPoints: number[];   // Values separating populations
    assignedPopulation: (number | null)[];  // Population ID per sample
    bic?: number;                 // Bayesian Information Criterion
    aic?: number;                 // Akaike Information Criterion
    logLikelihood?: number;
}

// =============================================================================
// ENHANCED CLUSTERING TYPES
// =============================================================================

export type ClusteringMethod =
    | 'kmeans'
    | 'hierarchical'
    | 'dbscan'
    | 'gaussian-mixture'
    | 'spectral';

export type HierarchicalLinkage = 'ward' | 'complete' | 'average' | 'single';

export type DistanceMetric =
    | 'euclidean'
    | 'manhattan'
    | 'logratio'      // Aitchison distance
    | 'correlation'
    | 'cosine';

export interface EnhancedClusteringConfig {
    method: ClusteringMethod;
    columns: string[];
    k?: number;                   // Number of clusters (for k-means)
    kRange?: [number, number];    // Range for automatic k selection

    // Transformation options
    transformationType?: 'none' | 'clr' | 'alr' | 'zscore';
    alrReference?: string;

    // Hierarchical options
    linkage?: HierarchicalLinkage;

    // Distance options
    distanceMetric?: DistanceMetric;

    // DBSCAN options
    eps?: number;                 // Neighborhood radius
    minSamples?: number;          // Minimum samples in neighborhood

    // Quality options
    calculateSilhouette?: boolean;
    nInitializations?: number;    // For k-means
    maxIterations?: number;
}

export interface ClusterDendrogramNode {
    id: string;
    left?: ClusterDendrogramNode;
    right?: ClusterDendrogramNode;
    height: number;               // Distance at merge
    indices: number[];            // Sample indices in this cluster
    count: number;
}

export interface EnhancedClusteringResult {
    method: ClusteringMethod;
    k: number;
    assignments: (number | null)[];
    centers?: number[][];         // Cluster centroids

    // Quality metrics
    withinClusterSS?: number;     // Total within-cluster sum of squares
    betweenClusterSS?: number;    // Between-cluster sum of squares
    totalSS?: number;
    bssOverTss?: number;          // BSS/TSS ratio
    silhouetteScores?: number[];
    avgSilhouette?: number;
    daviesBouldinIndex?: number;

    // Per-cluster statistics
    clusterStats: ClusterStatistics[];

    // For hierarchical
    dendrogram?: ClusterDendrogramNode;

    // For automatic k selection
    elbowData?: {
        k: number;
        inertia: number;
        silhouette?: number;
    }[];
    optimalK?: number;

    // Cross-tabulation with known groups
    crossTabulation?: {
        groupColumn: string;
        matrix: number[][];
        rowLabels: string[];
        colLabels: string[];
        accuracy?: number;
    };
}

export interface ClusterStatistics {
    clusterId: number;
    count: number;
    proportion: number;
    centroid: Record<string, number>;
    meanByColumn: Record<string, number>;
    stdByColumn: Record<string, number>;
}

// =============================================================================
// AMALGAMATION CLUSTERING (Element Grouping from GeoCoDA)
// =============================================================================

export interface AmalgamationClusteringConfig {
    elements: string[];           // Elements to cluster
    method: 'variance-explained' | 'correlation';
}

export interface ElementClusterNode {
    element?: string;             // Leaf node: element name
    left?: ElementClusterNode;
    right?: ElementClusterNode;
    height: number;               // Variance lost when merging
    elements: string[];           // All elements in this subtree
}

export interface AmalgamationClusteringResult {
    dendrogram: ElementClusterNode;
    elements: string[];
    suggestedAmalgamations: {
        name: string;
        elements: string[];
        varianceExplained: number;
        interpretation?: string;
    }[];
    varianceMatrix: number[][];   // Pairwise variance explained
}

// =============================================================================
// CLASSIFICATION TYPES
// =============================================================================

export type ClassificationMethod =
    | 'logistic-regression'
    | 'multinomial-logistic'
    | 'decision-tree'
    | 'random-forest'
    | 'lda'              // Linear Discriminant Analysis
    | 'qda'              // Quadratic Discriminant Analysis
    | 'knn';

export type VariableSelectionStrategy =
    | 'all-plr'          // All pairwise logratios
    | 'non-overlapping'  // Non-overlapping PLRs
    | 'alr'              // ALRs with same denominator
    | 'forward'          // Forward stepwise selection
    | 'backward'         // Backward elimination
    | 'best-subset';     // Best subset (exhaustive)

export interface ClassificationConfig {
    method: ClassificationMethod;
    targetColumn: string;         // Categorical column to predict
    featureColumns: string[];     // Input features

    // Logratio options
    useLogratios?: boolean;
    logratioType?: 'plr' | 'alr' | 'clr';
    alrReference?: string;

    // Variable selection
    variableSelection?: VariableSelectionStrategy;
    maxFeatures?: number;
    selectionCriterion?: 'aic' | 'bic' | 'accuracy';

    // Tree-based options
    maxDepth?: number;
    minSamplesLeaf?: number;
    minSamplesSplit?: number;

    // Random forest options
    nEstimators?: number;
    maxFeaturesFraction?: number;
    oobScore?: boolean;

    // KNN options
    kNeighbors?: number;

    // Validation options
    crossValidationFolds?: number;
    trainTestSplit?: number;      // Fraction for training (0.5-0.9)
    stratify?: boolean;
}

export interface ConfusionMatrix {
    matrix: number[][];
    classes: string[];
    accuracy: number;
    precision: Record<string, number>;
    recall: Record<string, number>;
    f1Score: Record<string, number>;
    support: Record<string, number>;
    macroAvg: {
        precision: number;
        recall: number;
        f1Score: number;
    };
    weightedAvg: {
        precision: number;
        recall: number;
        f1Score: number;
    };
}

export interface DecisionTreeNode {
    id: number;
    isLeaf: boolean;
    feature?: string;
    threshold?: number;
    operator?: '<=' | '>';
    left?: DecisionTreeNode;
    right?: DecisionTreeNode;
    prediction?: string;
    samples: number;
    classCounts: Record<string, number>;
    impurity?: number;            // Gini or entropy
}

export interface ClassificationResult {
    method: ClassificationMethod;
    targetColumn: string;
    classes: string[];

    // Predictions
    predictions: (string | null)[];
    probabilities?: Record<string, number>[];  // Per-class probabilities

    // Model performance
    trainConfusionMatrix?: ConfusionMatrix;
    testConfusionMatrix?: ConfusionMatrix;
    crossValidationAccuracy?: number;
    crossValidationStd?: number;
    oobAccuracy?: number;         // For random forest

    // Feature importance
    featureImportance?: {
        feature: string;
        importance: number;
        stdDev?: number;
    }[];

    // Selected features (if variable selection used)
    selectedFeatures?: string[];
    selectedLogratios?: {
        numerator: string;
        denominator: string;
        importance: number;
    }[];

    // Model coefficients (for logistic regression)
    coefficients?: {
        class: string;
        intercept: number;
        features: Record<string, number>;
    }[];

    // Decision tree structure
    decisionTree?: DecisionTreeNode;

    // Decision rules (human-readable)
    decisionRules?: string[];
}

// =============================================================================
// VARIABLE IMPORTANCE & SELECTION
// =============================================================================

export interface VarianceAnalysisResult {
    logratios: {
        numerator: string;
        denominator: string;
        contributedVariance: number;    // % of total logratio variance
        explainedVariance: number;      // R² when regressing all on this
        betweenGroupVariance?: number;  // For supervised tasks
        rank: number;
    }[];
    totalVariance: number;
    topContributors: string[];      // Top 10 PLRs by contributed variance
    topExplainers: string[];        // Top 10 PLRs by explained variance
}

// =============================================================================
// MULTIVARIATE OUTLIER DETECTION
// =============================================================================

export interface MahalanobisConfig {
    columns: string[];
    transformationType?: 'none' | 'clr' | 'zscore';
    useRobustEstimate?: boolean;  // Use MCD for covariance estimation
    chiSquaredAlpha?: number;     // Significance level (default: 0.05)
}

export interface MahalanobisResult {
    distances: (number | null)[];
    threshold: number;            // Chi-squared threshold
    isOutlier: boolean[];
    outlierIndices: number[];
    statistics: {
        meanVector: number[];
        covarianceMatrix: number[][];
        nOutliers: number;
        outlierRate: number;
    };
}

// =============================================================================
// STORE STATE TYPES
// =============================================================================

export interface StatisticsState {
    // Robust Regression
    regressionConfig: RobustRegressionConfig | null;
    regressionResult: RegressionResult | GroupedRegressionResult | null;

    // Anomaly Detection
    anomalyConfigs: AnomalyDetectionConfig[];
    anomalyResults: AnomalyResult[];

    // Population Separation
    populationConfig: PopulationSeparationConfig | null;
    populationResult: PopulationSeparationResult | null;

    // Clustering
    clusteringConfig: EnhancedClusteringConfig | null;
    clusteringResult: EnhancedClusteringResult | null;
    amalgamationResult: AmalgamationClusteringResult | null;

    // Classification
    classificationConfig: ClassificationConfig | null;
    classificationResult: ClassificationResult | null;

    // Variance Analysis
    varianceAnalysisResult: VarianceAnalysisResult | null;

    // Multivariate Outliers
    mahalanobisResult: MahalanobisResult | null;

    // History
    analysisHistory: AnalysisHistoryItem[];

    // UI State
    activeTab: 'regression' | 'anomaly' | 'population' | 'clustering' | 'classification';
    isProcessing: boolean;
    error: string | null;
}

export interface AnalysisHistoryItem {
    id: string;
    timestamp: Date;
    type: 'regression' | 'anomaly' | 'population' | 'clustering' | 'classification';
    config: any;
    resultSummary: string;
}
