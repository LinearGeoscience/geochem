/**
 * Type definitions for Element Association Recognition
 * Automated pattern matching for PCA-derived element associations
 * Based on "Interpreting Element Associations" geochemistry document
 */

// ============================================================================
// ASSOCIATION CATEGORY TYPES
// ============================================================================

export type AssociationCategory =
  | 'lithological'
  | 'regolith'
  | 'alteration'
  | 'mineralisation';

// ============================================================================
// REFERENCE PATTERN TYPES
// ============================================================================

/**
 * Defines a reference element association pattern for matching
 * Each pattern represents a known geological signature
 */
export interface ElementAssociationPattern {
  /** Unique identifier for the pattern (e.g., 'MIN_VHMS') */
  id: string;
  /** Human-readable name (e.g., 'VHMS Mineralisation') */
  name: string;
  /** Pattern category */
  category: AssociationCategory;

  // Element tiers for weighted matching
  /** Required/defining elements - highest matching weight */
  coreElements: string[];
  /** Frequently present elements - medium matching weight */
  commonElements: string[];
  /** Sometimes present elements - low matching weight */
  optionalElements: string[];
  /** Elements that should NOT be present - negative weight/penalty */
  antiElements: string[];

  // Matching parameters
  /** Minimum fraction of core elements needed for a valid match (0-1) */
  minimumCoreMatch: number;

  // Metadata
  /** Description of the pattern */
  description: string;
  /** Geological context where this pattern typically occurs */
  geologicalContext: string;
  /** IDs of patterns that can be easily confused with this one */
  similarPatterns: string[];
  /** Elements that help distinguish this from similar patterns */
  discriminatingElements: string[];
  /** Interpretation caveats and guidance */
  notes: string;
}

// ============================================================================
// MATCHING RESULT TYPES
// ============================================================================

/**
 * Detailed match score for a single pattern against an element association
 */
export interface MatchScore {
  /** Reference pattern ID */
  patternId: string;
  /** Pattern display name */
  patternName: string;
  /** Pattern category */
  category: AssociationCategory;
  /** Overall confidence score (0-100) */
  confidenceScore: number;

  // Score breakdown
  /** Score from core element matches (weight: 0.50) */
  coreMatchScore: number;
  /** Score from common element matches (weight: 0.25) */
  commonMatchScore: number;
  /** Score from optional element matches (weight: 0.10) */
  optionalMatchScore: number;
  /** Penalty from anti-elements present (weight: -0.15 per element) */
  antiElementPenalty: number;
  /** Bonus for strong loading magnitudes (weight: 0.15) */
  loadingStrengthBonus: number;

  // Match details
  /** Core elements found in the association */
  matchedCoreElements: string[];
  /** Common elements found in the association */
  matchedCommonElements: string[];
  /** Optional elements found in the association */
  matchedOptionalElements: string[];
  /** Anti-elements that were present (should not be) */
  presentAntiElements: string[];
  /** Core elements expected but not found (available in data but not in association) */
  missingCoreElements: string[];
  /** Core elements not measured in the dataset (excluded from scoring) */
  unavailableCoreElements?: string[];
  /** Common elements not measured in the dataset (excluded from scoring) */
  unavailableCommonElements?: string[];

  // Quality indicators
  /** Percentage of pattern elements found in association */
  patternCompleteness: number;
  /** Percentage of association elements that match the pattern */
  associationPurity: number;
  /** Whether lithophile elements are mixed in (quality warning) */
  lithophileInterference: boolean;
}

/**
 * Element with its loading value from PCA
 */
export interface ElementLoading {
  /** Element symbol */
  element: string;
  /** Loading value from scaled eigenvector */
  loading: number;
}

/**
 * Association extracted from one end of a principal component
 */
export interface ExtractedAssociation {
  /** Elements included in this association with their loadings */
  elements: ElementLoading[];
  /** Whether this is the positive or negative end of the PC */
  end: 'positive' | 'negative';
  /** Average absolute loading magnitude */
  averageLoadingMagnitude: number;
  /** Maximum absolute loading magnitude */
  maxLoadingMagnitude: number;
}

/**
 * Association analysis results with pattern matches
 */
export interface AssociationWithMatches {
  /** The extracted association */
  association: ExtractedAssociation;
  /** Ranked pattern matches (highest confidence first) */
  matches: MatchScore[];
  /** Element symbols as comma-separated string for display */
  elementString: string;
}

/**
 * Complete association analysis for a single principal component
 */
export interface PCAssociationAnalysis {
  /** Principal component number (1-indexed) */
  pcNumber: number;
  /** Percentage of variance explained by this PC */
  varianceExplained: number;
  /** Analysis of the positive end association */
  positiveAssociation: AssociationWithMatches;
  /** Analysis of the negative end association */
  negativeAssociation: AssociationWithMatches;
  /** Overall quality assessment for this PC */
  qualityAssessment: QualityAssessment;
}

// ============================================================================
// QUALITY ASSESSMENT TYPES
// ============================================================================

/**
 * Quality indicators for an association analysis
 */
export interface QualityAssessment {
  /** Whether mineralisation signature is independent of lithophile elements */
  mineralisationIndependent: boolean;
  /** Whether loadings are strong (>0.5 threshold) */
  strongLoadings: boolean;
  /** Whether there's clear separation between ore and host rock signatures */
  clearSeparation: boolean;
  /** Quality notes and warnings */
  notes: string[];
}

// ============================================================================
// DISCRIMINATION RULE TYPES
// ============================================================================

/**
 * Rule for discriminating between similar patterns
 */
export interface DiscriminationRule {
  /** First pattern ID */
  pattern1: string;
  /** Second pattern ID */
  pattern2: string;
  /** Elements that help discriminate */
  discriminators: string[];
  /** Description of how to apply the rule */
  rule: string;
  /** Whether context is needed beyond element loadings */
  requiresContext: boolean;
}

// ============================================================================
// ELEMENT NAME MAPPING TYPES
// ============================================================================

/**
 * Confidence level for element name detection
 */
export type ElementMappingConfidence = 'high' | 'medium' | 'low' | 'unknown';

/**
 * Mapping from original column name to standardized element symbol
 */
export interface ElementMapping {
  /** Original column name from data (e.g., "K_pct", "Ba_ppm") */
  originalName: string;
  /** Detected element symbol (e.g., "K", "Ba") or null if not detected */
  detectedElement: string | null;
  /** Confidence of the detection */
  confidence: ElementMappingConfidence;
  /** Detected unit (e.g., "ppm", "pct") or null */
  detectedUnit: string | null;
  /** Whether this column should be excluded (e.g., LOI, Total, Sample ID) */
  isExcluded: boolean;
  /** User-provided override for the element symbol */
  userOverride?: string;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Configuration options for pattern matching
 */
export interface MatchingOptions {
  /** Loading magnitude threshold for including elements (default: 0.3) */
  loadingThreshold?: number;
  /** Maximum number of matches to return per association (default: 5) */
  maxMatches?: number;
  /** Minimum confidence score to include in results (default: 25) */
  minimumConfidence?: number;
  /** Whether to apply discrimination rules (default: true) */
  applyDiscrimination?: boolean;
  /** Element mapping from original column names to element symbols */
  elementMapping?: Map<string, string>;
}

/**
 * Scoring configuration weights and thresholds
 */
export interface ScoringConfig {
  // Weights (should sum to 1.0)
  /** Weight for core element matches */
  coreWeight: number;
  /** Weight for common element matches */
  commonWeight: number;
  /** Weight for optional element matches */
  optionalWeight: number;
  /** Weight for loading strength bonus */
  loadingStrengthWeight: number;

  // Penalty
  /** Penalty per anti-element present (0-1) */
  antiElementPenalty: number;

  // Thresholds
  /** Strong loading threshold */
  loadingThresholdStrong: number;
  /** Moderate loading threshold */
  loadingThresholdModerate: number;
  /** Weak loading threshold (default cutoff) */
  loadingThresholdWeak: number;

  // Confidence thresholds
  /** High confidence score threshold */
  highConfidence: number;
  /** Moderate confidence score threshold */
  moderateConfidence: number;
  /** Low confidence score threshold */
  lowConfidence: number;

  /** Minimum confidence to report a match */
  minimumConfidenceToReport: number;
}

// ============================================================================
// STORE STATE TYPES
// ============================================================================

/**
 * State for association analysis in the transformation store
 */
export interface AssociationState {
  /** Results of association analysis for all PCs */
  results: PCAssociationAnalysis[] | null;
  /** Whether analysis is currently running */
  isAnalyzing: boolean;
  /** Error message if analysis failed */
  error: string | null;
  /** Options used for the current analysis */
  options: MatchingOptions;
  /** Timestamp of last analysis */
  lastAnalyzed: Date | null;
}

// ============================================================================
// LITHOPHILE ELEMENTS (for quality checks)
// ============================================================================

/**
 * Elements that indicate lithological (rock-type) signature rather than mineralisation
 * Used to check if mineralisation patterns are "clean" vs mixed with host rock
 */
export const LITHOPHILE_ELEMENTS = [
  'Al', 'Zr', 'Ti', 'Y', 'Hf', 'Nb', 'Th', 'Ga', 'Sc'
] as const;

export type LithophileElement = typeof LITHOPHILE_ELEMENTS[number];

// ============================================================================
// EXPORT TYPES
// ============================================================================

/**
 * Association interpretation for CSV export
 */
export interface AssociationExportRow {
  pcNumber: number;
  varianceExplained: number;
  end: 'positive' | 'negative';
  elements: string;
  rank: number;
  patternName: string;
  category: AssociationCategory;
  confidenceScore: number;
  matchedCoreElements: string;
  missingCoreElements: string;
  patternCompleteness: number;
  notes: string;
}

// ============================================================================
// CUSTOM ASSOCIATION TYPES
// ============================================================================

/**
 * User-defined custom element association
 * Created by selecting elements on eigenvector plots
 */
export interface CustomAssociation {
  /** Unique identifier */
  id: string;
  /** User-provided name for the association */
  name: string;
  /** Original column names from the data (e.g., "Y_ppm", "Cu_ppm") */
  elements: string[];
  /** Normalized element symbols (e.g., "Y", "Cu") */
  elementSymbols: string[];
  /** PC number this association was created from */
  pcNumber: number;
  /** Which end of the PC (positive or negative loadings) */
  side: 'positive' | 'negative';
  /** Color for highlighting this association */
  color: string;
  /** When the association was created */
  createdAt: Date;
}
