/**
 * Type definitions for Compositional Data Analysis (CoDA)
 * Based on GeoCoDA workflow
 */

// ============================================================================
// TRANSFORMATION TYPES
// ============================================================================

export type TransformationType = 'plr' | 'alr' | 'clr' | 'ilr' | 'slr' | 'chipower' | 'log-additive' | 'none';

export type ZeroHandlingStrategy =
  | 'half-min'
  | 'half-dl'
  | 'small-constant'
  | 'multiplicative'
  | 'custom';

export type ZeroType = 'structural' | 'missing' | 'below-dl' | 'unknown';

export interface TransformationConfig {
  type: TransformationType;
  columns: string[];
  zeroStrategy: ZeroHandlingStrategy;
  customZeroValue?: number;
  detectionLimits?: Record<string, number>;

  // ALR-specific
  alrReference?: string;

  // SLR-specific
  slrNumeratorGroup?: string[];
  slrDenominatorGroup?: string[];

  // chiPower-specific
  chiPowerLambda?: number;
}

export interface TransformationResult {
  id: string;
  config: TransformationConfig;
  values: number[][];
  columnNames: string[];
  zerosReplaced: number;
  timestamp: Date;

  // ALR-specific results
  procrustesCorrelation?: number;

  // Variance info
  varianceExplained?: number[];
}

// ============================================================================
// AMALGAMATION TYPES
// ============================================================================

export type AmalgamationCategory =
  | 'mantle'
  | 'crustal'
  | 'magmatic'
  | 'felsic'
  | 'mafic'
  | 'ree'
  | 'pathfinder'
  | 'custom';

export interface AmalgamationDefinition {
  id: string;
  name: string;
  description: string;
  elements: string[];
  category: AmalgamationCategory;
  isBuiltIn: boolean;
}

export interface AmalgamationMapping {
  definitionId: string;
  matchedColumns: string[];
  missingElements: string[];
}

// ============================================================================
// VARIANCE DECOMPOSITION TYPES
// ============================================================================

export interface PLRVarianceInfo {
  plrName: string;
  numerator: string;
  denominator: string;
  contributedVariance: number;  // % of total logratio variance
  explainedVariance: number;    // R² with all other PLRs
  betweenGroupVariance?: number; // % between-group variance (if groups provided)
}

export interface VarianceDecompositionResult {
  totalLogratioVariance: number;
  plrVariances: PLRVarianceInfo[];
  topByContributed: PLRVarianceInfo[];
  topByExplained: PLRVarianceInfo[];
  topByBetweenGroup?: PLRVarianceInfo[];
}

// ============================================================================
// PROCRUSTES ANALYSIS TYPES
// ============================================================================

export interface ProcrustesResult {
  referenceElement: string;
  correlation: number;
  rankings: Array<{
    element: string;
    correlation: number;
  }>;
}

// ============================================================================
// ZERO CLASSIFICATION TYPES
// ============================================================================

export interface ZeroClassification {
  rowIndex: number;
  column: string;
  type: ZeroType;
  detectionLimit?: number;
  replacementValue?: number;
}

export interface ZeroSummary {
  totalZeros: number;
  byType: Record<ZeroType, number>;
  byColumn: Record<string, number>;
  classifications: ZeroClassification[];
}

// ============================================================================
// PCA / LRA TYPES
// ============================================================================

export interface PCAResult {
  scores: number[][];           // Sample scores [n x nComponents]
  loadings: number[][];         // Variable loadings [p x nComponents]
  eigenvalues: number[];        // Eigenvalues
  varianceExplained: number[];  // % variance per component
  cumulativeVariance: number[]; // Cumulative % variance
  columns: string[];            // Column names
}

/**
 * Full PCA Result with all outputs for the exploration geochemistry workflow
 * Includes scaled eigenvectors (loadings) for element association analysis
 */
export interface FullPCAResult {
  /** Sample scores projected onto principal components [n_samples x n_components] */
  scores: number[][];
  /** Scaled eigenvectors (loadings) [n_variables x n_components] - key for element associations */
  loadings: number[][];
  /** Raw eigenvectors (unscaled) [n_components x n_variables] */
  eigenvectors: number[][];
  /** Eigenvalues for each component */
  eigenvalues: number[];
  /** Percentage of variance explained by each component */
  varianceExplained: number[];
  /** Cumulative variance explained */
  cumulativeVariance: number[];
  /** Correlation matrix of CLR-transformed data */
  correlationMatrix: number[][];
  /** Column/variable names */
  columns: string[];
  /** Column means (for centering) */
  means: number[];
  /** Number of samples used in analysis */
  nSamples: number;
  /** Number of zeros replaced during CLR transformation */
  zerosReplaced: number;
}

/**
 * Element quality assessment for PCA element selection
 */
export interface ElementQualityInfo {
  element: string;
  /** N-score position of Below Detection Limit values */
  bldNScore: number;
  /** Percentage of values below detection limit */
  percentBLD: number;
  /** Count of BLD values */
  countBLD: number;
  /** Total count of values */
  totalCount: number;
  /** Whether element passes quality check (BLD N-score < -1) */
  isAcceptable: boolean;
}

/**
 * Sorted loading for a single element in a PC
 */
export interface SortedLoading {
  element: string;
  loading: number;
}

export interface BiplotData {
  samples: Array<{
    id: string | number;
    x: number;
    y: number;
    group?: string;
  }>;
  variables: Array<{
    name: string;
    x: number;
    y: number;
  }>;
  variancePC1: number;
  variancePC2: number;
}

// ============================================================================
// CLUSTERING TYPES
// ============================================================================

export type ClusteringMethod = 'hierarchical' | 'kmeans';
export type LinkageMethod = 'ward' | 'complete' | 'average' | 'single';
export type DistanceMetric = 'euclidean' | 'logratio' | 'chi-square';

export interface ClusteringConfig {
  method: ClusteringMethod;
  nClusters: number;
  transformation: TransformationType;
  linkage?: LinkageMethod;
  distance?: DistanceMetric;
}

export interface ClusteringResult {
  labels: number[];             // Cluster assignment per sample
  centroids?: number[][];       // Cluster centroids
  silhouetteScore?: number;     // Clustering quality
  bssToTss?: number;           // Between-group SS / Total SS
  dendrogram?: DendrogramNode;  // For hierarchical clustering
}

export interface DendrogramNode {
  id: number;
  children?: DendrogramNode[];
  height: number;
  members: number[];
}

// ============================================================================
// CLASSIFICATION TYPES
// ============================================================================

export type ClassificationMethod = 'logistic' | 'tree' | 'randomforest';

export interface ClassificationConfig {
  method: ClassificationMethod;
  targetColumn: string;
  predictorLogratios: string[];
  transformation: TransformationType;
  crossValidationFolds?: number;
}

export interface ClassificationResult {
  predictions: string[];
  probabilities?: number[][];
  accuracy: number;
  crossValidationAccuracy?: number;
  confusionMatrix: number[][];
  classNames: string[];
  featureImportance?: Array<{
    feature: string;
    importance: number;
  }>;
}

export interface LogisticRegressionResult extends ClassificationResult {
  coefficients: Record<string, number>;
  intercepts: Record<string, number>;
  standardErrors: Record<string, number>;
}

export interface DecisionTreeResult extends ClassificationResult {
  tree: DecisionTreeNode;
  rules: string[];
}

export interface DecisionTreeNode {
  feature?: string;
  threshold?: number;
  left?: DecisionTreeNode;
  right?: DecisionTreeNode;
  prediction?: string;
  samples: number;
  classCounts: Record<string, number>;
}

// ============================================================================
// EXPORT / IMPORT TYPES
// ============================================================================

export interface TransformedDataExport {
  transformation: TransformationConfig;
  data: Record<string, any>[];
  metadata: {
    originalColumns: string[];
    transformedColumns: string[];
    zerosReplaced: number;
    timestamp: string;
  };
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

export interface TransformationUIState {
  selectedTransformation: TransformationType;
  selectedColumns: string[];
  zeroStrategy: ZeroHandlingStrategy;
  showAdvancedOptions: boolean;
  isProcessing: boolean;
  error?: string;

  // Results
  currentResult?: TransformationResult;
  varianceDecomposition?: VarianceDecompositionResult;
  procrustesAnalysis?: ProcrustesResult;
}

// ============================================================================
// LOG ADDITIVE INDEX TYPES
// ============================================================================

export interface LogAdditiveIndexConfig {
  name: string;
  columns: string[];
  zeroStrategy: ZeroHandlingStrategy;
  customZeroValue?: number;
}

export interface LogAdditiveIndexResult {
  id: string;
  name: string;
  columns: string[];
  values: (number | null)[];
  statistics: {
    min: number;
    max: number;
    mean: number;
    zerosReplaced: number;
  };
  timestamp: Date;
}
