/**
 * QA/QC Types and Interfaces
 * Comprehensive type definitions for Quality Assurance / Quality Control module
 */

// ============================================================================
// SAMPLE TYPES
// ============================================================================

export type QCSampleType =
  | 'standard'       // CRM/Standard reference material
  | 'blank'          // Field blank, lab blank
  | 'field_duplicate'  // Field duplicate (same location, separate sample)
  | 'pulp_duplicate'   // Pulp duplicate (same pulp, re-analyzed)
  | 'core_duplicate'   // Core duplicate (quarter core)
  | 'unknown';         // Unclassified QC sample

export type SampleCategory = 'primary' | 'qc';

// ============================================================================
// DETECTION PATTERNS
// ============================================================================

export interface QCDetectionPattern {
  type: QCSampleType;
  patterns: RegExp[];
  description: string;
}

export const DEFAULT_QC_PATTERNS: QCDetectionPattern[] = [
  {
    type: 'standard',
    patterns: [
      /^STD[-_]?/i,
      /^CRM[-_]?/i,
      /^OREAS[-_]?/i,
      /^GEOSTATS[-_]?/i,
      /^SRM[-_]?/i,
      /^REF[-_]?/i,
      /STANDARD/i,
      /^GBM[-_]?/i,
      /^AMIS[-_]?/i,
    ],
    description: 'Standard Reference Materials / Certified Reference Materials'
  },
  {
    type: 'blank',
    patterns: [
      /^BLK[-_]?/i,
      /^BLANK/i,
      /^FB[-_]?/i,         // Field blank
      /^LB[-_]?/i,         // Lab blank
      /^MB[-_]?/i,         // Method blank
      /BLANK$/i,
    ],
    description: 'Blank samples for contamination detection'
  },
  {
    type: 'field_duplicate',
    patterns: [
      /[-_]DUP$/i,
      /[-_]FD$/i,          // Field duplicate
      /[-_]A$/i,           // Will need pair detection for -B
      /^DUP[-_]?/i,
      /DUPLICATE/i,
    ],
    description: 'Field duplicates for sampling precision'
  },
  {
    type: 'pulp_duplicate',
    patterns: [
      /[-_]PD$/i,          // Pulp duplicate
      /[-_]RPT$/i,         // Repeat analysis
      /[-_]REP$/i,         // Replicate
      /PULP[-_]?DUP/i,
    ],
    description: 'Pulp duplicates for analytical precision'
  },
  {
    type: 'core_duplicate',
    patterns: [
      /[-_]CD$/i,          // Core duplicate
      /[-_]QC$/i,          // Quarter core
      /CORE[-_]?DUP/i,
    ],
    description: 'Core duplicates for sub-sampling precision'
  }
];

// ============================================================================
// STANDARD REFERENCE VALUES
// ============================================================================

export interface StandardReferenceValue {
  element: string;
  certifiedValue: number;
  certifiedUncertainty?: number;  // 2-sigma uncertainty
  unit?: string;
}

export interface StandardReference {
  id: string;
  name: string;
  supplier?: string;
  matrix?: string;  // e.g., "Rock", "Soil", "Stream Sediment"
  values: StandardReferenceValue[];
}

// ============================================================================
// QC SAMPLE RECORDS
// ============================================================================

export interface QCSample {
  rowIndex: number;
  sampleId: string;
  qcType: QCSampleType;
  standardName?: string;     // For standards, which CRM
  duplicatePairId?: string;  // For duplicates, the original sample ID
  batchId?: string;
  sequenceNumber?: number;
  isManuallyTagged: boolean;
}

export interface DuplicatePair {
  originalIndex: number;
  duplicateIndex: number;
  originalId: string;
  duplicateId: string;
  duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate';
}

// ============================================================================
// CONTROL CHART DATA
// ============================================================================

export interface ControlLimits {
  mean: number;
  standardDeviation: number;
  upperWarningLimit: number;   // +2σ
  lowerWarningLimit: number;   // -2σ
  upperControlLimit: number;   // +3σ
  lowerControlLimit: number;   // -3σ
  certifiedValue?: number;
  certifiedUncertainty?: number;
}

export interface ControlChartPoint {
  index: number;
  rowIndex: number;
  sampleId: string;
  value: number;
  batchId?: string;
  status: 'pass' | 'warning' | 'fail';
  recovery?: number;  // Measured/Certified × 100
}

export interface ControlChartData {
  standardName: string;
  element: string;
  limits: ControlLimits;
  points: ControlChartPoint[];
  passCount: number;
  warningCount: number;
  failCount: number;
  biasDetected: boolean;
  driftDetected: boolean;
}

// ============================================================================
// DUPLICATE ANALYSIS
// ============================================================================

export interface DuplicateResult {
  pairIndex: number;
  originalId: string;
  duplicateId: string;
  originalValue: number;
  duplicateValue: number;
  rpd: number;           // Relative Percent Difference
  ard: number;           // Absolute Relative Difference
  mean: number;
  status: 'pass' | 'fail';
  duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate';
}

export interface DuplicateAnalysis {
  element: string;
  duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate';
  threshold: number;     // RPD threshold (30% field, 10% pulp)
  results: DuplicateResult[];
  passCount: number;
  failCount: number;
  passRate: number;
  meanRPD: number;
  medianRPD: number;
  precision: number;     // Overall precision estimate
}

// ============================================================================
// BLANK ANALYSIS
// ============================================================================

export interface BlankResult {
  index: number;
  rowIndex: number;
  sampleId: string;
  value: number;
  detectionLimit?: number;
  status: 'clean' | 'elevated' | 'contaminated';
  multipleOfDL?: number;
  precedingSampleId?: string;
  precedingSampleValue?: number;
}

export interface BlankAnalysis {
  element: string;
  detectionLimit?: number;
  results: BlankResult[];
  cleanCount: number;
  elevatedCount: number;    // 5-10× DL
  contaminatedCount: number; // >10× DL
  maxValue: number;
  meanValue: number;
  contaminationEvents: number;  // Contamination after high-grade
}

// ============================================================================
// QC SUMMARY & DASHBOARD
// ============================================================================

export interface ElementQCSummary {
  element: string;
  standardsAnalyzed: number;
  standardsPass: number;
  standardsPassRate: number;
  blanksAnalyzed: number;
  blanksClean: number;
  blanksPassRate: number;
  duplicatesAnalyzed: number;
  duplicatesPass: number;
  duplicatesPassRate: number;
  overallScore: number;  // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface BatchQCSummary {
  batchId: string;
  sampleCount: number;
  standardCount: number;
  blankCount: number;
  duplicateCount: number;
  insertionRate: number;  // QC samples / total × 100
  passRate: number;
  issues: string[];
}

export interface QAQCReport {
  generatedAt: string;
  datasetName: string;
  totalSamples: number;
  qcSamples: number;
  insertionRate: number;
  elementSummaries: ElementQCSummary[];
  batchSummaries: BatchQCSummary[];
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  recommendations: string[];
}

// ============================================================================
// THRESHOLDS & CONFIGURATION
// ============================================================================

export interface QAQCThresholds {
  fieldDuplicateRPD: number;      // Default: 30%
  pulpDuplicateRPD: number;       // Default: 10%
  coreDuplicateRPD: number;       // Default: 20%
  blankElevatedMultiple: number;  // Default: 5× DL
  blankContaminatedMultiple: number; // Default: 10× DL
  standardWarningSigma: number;   // Default: 2
  standardFailSigma: number;      // Default: 3
  minInsertionRate: number;       // Default: 5%
}

export const DEFAULT_QAQC_THRESHOLDS: QAQCThresholds = {
  fieldDuplicateRPD: 30,
  pulpDuplicateRPD: 10,
  coreDuplicateRPD: 20,
  blankElevatedMultiple: 5,
  blankContaminatedMultiple: 10,
  standardWarningSigma: 2,
  standardFailSigma: 3,
  minInsertionRate: 5,
};
