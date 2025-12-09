/**
 * Statistics Module - Stage 5 Implementation
 * Robust Statistical Methods & Machine Learning for Geochemical Data
 */

// Robust Regression
export {
    performRobustRegression,
    calculateAdjustedResiduals,
} from './robustRegression';

// Anomaly Detection
export {
    detectAnomalies,
    detectMahalanobisOutliers,
    detectMultiColumnAnomalies,
    combineAnomalyResults,
} from './anomalyDetection';

// Clustering
export {
    performClustering,
    performAmalgamationClustering,
    calculateCrossTabulation,
} from './clustering';

// Classification
export {
    performClassification,
    crossValidate,
} from './classification';

// Population Separation
export {
    separatePopulations,
} from './populationSeparation';

// Re-export types
export type {
    // Regression types
    RegressionMethod,
    RobustRegressionConfig,
    RegressionResult,
    GroupedRegressionResult,

    // Anomaly types
    AnomalyMethod,
    AnomalyDetectionConfig,
    AnomalyResult,
    MahalanobisConfig,
    MahalanobisResult,

    // Population types
    PopulationSeparationConfig,
    PopulationSeparationResult,
    DetectedPopulation,

    // Clustering types
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

    // Classification types
    ClassificationMethod,
    VariableSelectionStrategy,
    ClassificationConfig,
    ClassificationResult,
    ConfusionMatrix,
    DecisionTreeNode,

    // Variance analysis
    VarianceAnalysisResult,

    // Store types
    StatisticsState,
    AnalysisHistoryItem,
} from '../../types/statistics';
