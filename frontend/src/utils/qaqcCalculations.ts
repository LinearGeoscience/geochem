/**
 * QA/QC Calculation Utilities
 * Statistical calculations for control charts, duplicate analysis, and blank analysis
 */

import {
  ControlLimits,
  ControlChartPoint,
  ControlChartData,
  DuplicateResult,
  DuplicateAnalysis,
  BlankResult,
  BlankAnalysis,
  QCSample,
  DuplicatePair,
  StandardReference,
  QAQCThresholds,
  DEFAULT_QAQC_THRESHOLDS,
  ElementQCSummary,
  WestgardViolation,
  ThompsonHowarthBin,
  ThompsonHowarthResult,
} from '../types/qaqc';

// ============================================================================
// STATISTICAL HELPERS
// ============================================================================

/**
 * Calculate mean of an array
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
export function standardDeviation(values: number[], sampleSD = true): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / (sampleSD ? values.length - 1 : values.length);
  return Math.sqrt(variance);
}

/**
 * Calculate median
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate percentile
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// ============================================================================
// CONTROL CHART CALCULATIONS
// ============================================================================

/**
 * Calculate control limits for a standard
 * Can use either measured statistics or certified values
 */
export function calculateControlLimits(
  values: number[],
  certifiedValue?: number,
  certifiedUncertainty?: number,
  warningSigma: number = 2,
  failSigma: number = 3
): ControlLimits {
  const avg = mean(values);
  const sd = standardDeviation(values);

  // Use measured statistics by default
  let centerLine = avg;
  let sigma = sd;

  // If certified values provided and have enough data, blend them
  if (certifiedValue !== undefined) {
    centerLine = certifiedValue;
    // Use measured SD unless certified uncertainty is larger
    if (certifiedUncertainty !== undefined && certifiedUncertainty > sd) {
      sigma = certifiedUncertainty / 2; // Convert 2-sigma to 1-sigma
    }
  }

  // Ensure we have reasonable sigma (prevent division issues)
  if (sigma === 0 || !isFinite(sigma)) {
    sigma = Math.abs(centerLine) * 0.05; // Default to 5% of mean
  }

  return {
    mean: avg,
    standardDeviation: sd,
    upperWarningLimit: centerLine + warningSigma * sigma,
    lowerWarningLimit: centerLine - warningSigma * sigma,
    upperControlLimit: centerLine + failSigma * sigma,
    lowerControlLimit: centerLine - failSigma * sigma,
    certifiedValue,
    certifiedUncertainty,
  };
}

/**
 * Evaluate a single control chart point
 */
export function evaluateControlPoint(
  value: number,
  limits: ControlLimits
): 'pass' | 'warning' | 'fail' {
  if (value > limits.upperControlLimit || value < limits.lowerControlLimit) {
    return 'fail';
  }
  if (value > limits.upperWarningLimit || value < limits.lowerWarningLimit) {
    return 'warning';
  }
  return 'pass';
}

/**
 * Calculate recovery percentage
 */
export function calculateRecovery(measured: number, certified: number): number {
  if (certified === 0) return 0;
  return (measured / certified) * 100;
}

/**
 * Detect bias (two consecutive warnings on same side)
 */
export function detectBias(points: ControlChartPoint[], limits: ControlLimits): boolean {
  const centerLine = limits.certifiedValue ?? limits.mean;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    // Both warnings and on same side of center
    if (prev.status === 'warning' && curr.status === 'warning') {
      const prevSide = prev.value > centerLine ? 'above' : 'below';
      const currSide = curr.value > centerLine ? 'above' : 'below';
      if (prevSide === currSide) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect drift (systematic trend over time)
 * Uses simple linear regression to check for significant slope
 */
export function detectDrift(points: ControlChartPoint[]): boolean {
  if (points.length < 5) return false;

  const x = points.map((_, i) => i);
  const y = points.map(p => p.value);

  // Calculate linear regression
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgY = sumY / n;

  // Check if slope is significant relative to mean (>2% per point)
  const relativeSlope = Math.abs(slope / avgY) * 100;
  return relativeSlope > 2;
}

// ============================================================================
// WESTGARD / NELSON CONTROL RULES (Feature 2.1)
// ============================================================================

/**
 * Detect Westgard/Nelson control rule violations on a series of control chart points.
 */
export function detectWestgardViolations(
  points: ControlChartPoint[],
  limits: ControlLimits
): WestgardViolation[] {
  const violations: WestgardViolation[] = [];
  const centerLine = limits.certifiedValue ?? limits.mean;
  const sigma = (limits.upperControlLimit - centerLine) / 3;

  if (points.length < 2 || sigma === 0) return violations;

  // R-4s: Range of two consecutive points exceeds 4 sigma
  for (let i = 1; i < points.length; i++) {
    const range = Math.abs(points[i].value - points[i - 1].value);
    if (range > 4 * sigma) {
      violations.push({
        rule: 'R-4s',
        pointIndices: [i - 1, i],
        description: `Range of ${range.toFixed(3)} between points ${i} and ${i + 1} exceeds 4σ (${(4 * sigma).toFixed(3)})`,
      });
    }
  }

  // 4-1s: 4 consecutive points beyond ±1 sigma on the same side
  if (points.length >= 4) {
    for (let i = 0; i <= points.length - 4; i++) {
      const window = points.slice(i, i + 4);
      const allAbove = window.every(p => p.value > centerLine + sigma);
      const allBelow = window.every(p => p.value < centerLine - sigma);
      if (allAbove || allBelow) {
        violations.push({
          rule: '4-1s',
          pointIndices: [i, i + 1, i + 2, i + 3],
          description: `4 consecutive points beyond ±1σ on the ${allAbove ? 'high' : 'low'} side (points ${i + 1}–${i + 4})`,
        });
        break; // Report once
      }
    }
  }

  // 10-x: 10 consecutive points on the same side of the center line
  if (points.length >= 10) {
    for (let i = 0; i <= points.length - 10; i++) {
      const window = points.slice(i, i + 10);
      const allAbove = window.every(p => p.value > centerLine);
      const allBelow = window.every(p => p.value < centerLine);
      if (allAbove || allBelow) {
        violations.push({
          rule: '10-x',
          pointIndices: Array.from({ length: 10 }, (_, j) => i + j),
          description: `10 consecutive points on the ${allAbove ? 'high' : 'low'} side of center (points ${i + 1}–${i + 10})`,
        });
        break;
      }
    }
  }

  // 7T: 7 consecutive points trending in the same direction
  if (points.length >= 7) {
    for (let i = 0; i <= points.length - 7; i++) {
      const window = points.slice(i, i + 7);
      let allIncreasing = true;
      let allDecreasing = true;
      for (let j = 1; j < window.length; j++) {
        if (window[j].value <= window[j - 1].value) allIncreasing = false;
        if (window[j].value >= window[j - 1].value) allDecreasing = false;
      }
      if (allIncreasing || allDecreasing) {
        violations.push({
          rule: '7T',
          pointIndices: Array.from({ length: 7 }, (_, j) => i + j),
          description: `7 consecutive points ${allIncreasing ? 'increasing' : 'decreasing'} (points ${i + 1}–${i + 7})`,
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * Build complete control chart data for a standard and element
 */
export function buildControlChart(
  data: Record<string, any>[],
  standardSamples: QCSample[],
  element: string,
  standardName: string,
  reference?: StandardReference,
  thresholds: QAQCThresholds = DEFAULT_QAQC_THRESHOLDS
): ControlChartData | null {
  // Filter samples for this standard
  const samples = standardSamples.filter(s => s.standardName === standardName);
  if (samples.length === 0) return null;

  // Get values for this element
  const values: { index: number; rowIndex: number; sampleId: string; value: number; batchId?: string }[] = [];

  samples.forEach((sample, idx) => {
    const value = data[sample.rowIndex]?.[element];
    if (typeof value === 'number' && !isNaN(value)) {
      values.push({
        index: idx,
        rowIndex: sample.rowIndex,
        sampleId: sample.sampleId,
        value,
        batchId: sample.batchId,
      });
    }
  });

  if (values.length === 0) return null;

  // Get certified values if available
  const certifiedValue = reference?.values.find(v => v.element === element)?.certifiedValue;
  const certifiedUncertainty = reference?.values.find(v => v.element === element)?.certifiedUncertainty;

  // Calculate limits
  const limits = calculateControlLimits(
    values.map(v => v.value),
    certifiedValue,
    certifiedUncertainty,
    thresholds.standardWarningSigma,
    thresholds.standardFailSigma
  );

  // Evaluate each point
  const points: ControlChartPoint[] = values.map(v => ({
    ...v,
    status: evaluateControlPoint(v.value, limits),
    recovery: certifiedValue ? calculateRecovery(v.value, certifiedValue) : undefined,
  }));

  // Count statuses
  const passCount = points.filter(p => p.status === 'pass').length;
  const warningCount = points.filter(p => p.status === 'warning').length;
  const failCount = points.filter(p => p.status === 'fail').length;

  return {
    standardName,
    element,
    limits,
    points,
    passCount,
    warningCount,
    failCount,
    biasDetected: detectBias(points, limits),
    driftDetected: detectDrift(points),
    westgardViolations: detectWestgardViolations(points, limits),
  };
}

// ============================================================================
// DUPLICATE ANALYSIS CALCULATIONS
// ============================================================================

/**
 * Calculate Relative Percent Difference (RPD)
 * RPD = |A - B| / ((A + B) / 2) × 100
 */
export function calculateRPD(valueA: number, valueB: number): number {
  const avg = (valueA + valueB) / 2;
  if (avg === 0) return 0;
  return (Math.abs(valueA - valueB) / avg) * 100;
}

/**
 * Calculate Absolute Relative Difference (ARD)
 * ARD = |A - B| / A × 100 (relative to original)
 */
export function calculateARD(original: number, duplicate: number): number {
  if (original === 0) return 0;
  return (Math.abs(original - duplicate) / original) * 100;
}

/**
 * Calculate Half Absolute Relative Difference (HARD)
 * HARD = |A - B| / (A + B) × 100
 */
export function calculateHARD(valueA: number, valueB: number): number {
  const sum = valueA + valueB;
  if (sum === 0) return 0;
  return (Math.abs(valueA - valueB) / sum) * 100;
}

/**
 * Analyze duplicates for a specific element.
 *
 * Fix 1.10: Correct 1-sigma precision estimate: s = sqrt(Sum(d^2)/2n)
 * Feature 2.2: Flag below-detection-limit pairs (both values < 5× DL)
 */
export function analyzeDuplicates(
  data: Record<string, any>[],
  pairs: DuplicatePair[],
  element: string,
  duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate',
  thresholds: QAQCThresholds = DEFAULT_QAQC_THRESHOLDS,
  detectionLimit?: number
): DuplicateAnalysis | null {
  const results: DuplicateResult[] = [];

  // Get threshold for this duplicate type
  let threshold: number;
  switch (duplicateType) {
    case 'field_duplicate':
      threshold = thresholds.fieldDuplicateRPD;
      break;
    case 'pulp_duplicate':
      threshold = thresholds.pulpDuplicateRPD;
      break;
    case 'core_duplicate':
      threshold = thresholds.coreDuplicateRPD;
      break;
    default:
      threshold = 30;
  }

  // Calculate RPD for each pair
  pairs.forEach((pair, idx) => {
    const originalValue = data[pair.originalIndex]?.[element];
    const duplicateValue = data[pair.duplicateIndex]?.[element];

    if (typeof originalValue !== 'number' || typeof duplicateValue !== 'number') {
      return;
    }

    if (isNaN(originalValue) || isNaN(duplicateValue)) {
      return;
    }

    const rpd = calculateRPD(originalValue, duplicateValue);
    const ard = calculateARD(originalValue, duplicateValue);
    const avg = (originalValue + duplicateValue) / 2;

    // Feature 2.2: Flag below-detection-limit pairs
    const belowDetection = detectionLimit
      ? (originalValue < 5 * detectionLimit && duplicateValue < 5 * detectionLimit)
      : undefined;

    results.push({
      pairIndex: idx,
      originalId: pair.originalId,
      duplicateId: pair.duplicateId,
      originalValue,
      duplicateValue,
      rpd,
      ard,
      mean: avg,
      status: rpd <= threshold ? 'pass' : 'fail',
      duplicateType,
      belowDetection,
    });
  });

  if (results.length === 0) return null;

  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const rpdValues = results.map(r => r.rpd);
  const meanRPD = mean(rpdValues);

  // Fix 1.10: Correct 1-sigma precision: s = sqrt(Sum(d^2)/2n)
  // Exclude BDL pairs from precision calculation
  const precisionResults = results.filter(r => !r.belowDetection);
  let absolutePrecision = 0;
  let relativePrecision = 0;
  if (precisionResults.length > 0) {
    const differences = precisionResults.map(r => r.originalValue - r.duplicateValue);
    const sumSquaredDiffs = differences.reduce((sum, d) => sum + d * d, 0);
    absolutePrecision = Math.sqrt(sumSquaredDiffs / (2 * precisionResults.length));
    const overallMean = mean(precisionResults.map(r => r.mean));
    relativePrecision = overallMean !== 0 ? (absolutePrecision / overallMean) * 100 : 0;
  }

  return {
    element,
    duplicateType,
    threshold,
    results,
    passCount,
    failCount,
    passRate: (passCount / results.length) * 100,
    meanRPD,
    medianRPD: median(rpdValues),
    precision: meanRPD / 2, // Legacy field
    absolutePrecision,
    relativePrecision,
  };
}

// ============================================================================
// BLANK ANALYSIS CALCULATIONS
// ============================================================================

/**
 * Analyze blanks for a specific element
 */
export function analyzeBlanks(
  data: Record<string, any>[],
  blankSamples: QCSample[],
  element: string,
  detectionLimit?: number,
  thresholds: QAQCThresholds = DEFAULT_QAQC_THRESHOLDS
): BlankAnalysis | null {
  const results: BlankResult[] = [];

  blankSamples.forEach((sample, idx) => {
    const value = data[sample.rowIndex]?.[element];

    if (typeof value !== 'number' || isNaN(value)) {
      return;
    }

    // Feature 2.6: DL/2 substitution for negative values
    let adjustedValue: number | undefined;
    if (value < 0 && detectionLimit && detectionLimit > 0) {
      adjustedValue = detectionLimit / 2;
    }

    const evalValue = adjustedValue ?? value;

    let status: 'clean' | 'elevated' | 'contaminated' = 'clean';
    let multipleOfDL: number | undefined;

    if (detectionLimit && detectionLimit > 0) {
      multipleOfDL = evalValue / detectionLimit;
      if (multipleOfDL > thresholds.blankContaminatedMultiple) {
        status = 'contaminated';
      } else if (multipleOfDL > thresholds.blankElevatedMultiple) {
        status = 'elevated';
      }
    } else {
      // Without DL, use statistical thresholds
      // Will be evaluated after collecting all values
    }

    // Check preceding sample for contamination source
    let precedingSampleId: string | undefined;
    let precedingSampleValue: number | undefined;

    if (sample.rowIndex > 0) {
      const precedingRow = data[sample.rowIndex - 1];
      if (precedingRow) {
        // Get sample ID from first text column (heuristic)
        const keys = Object.keys(precedingRow);
        const textKey = keys.find(k => typeof precedingRow[k] === 'string');
        if (textKey) {
          precedingSampleId = String(precedingRow[textKey]);
        }
        precedingSampleValue = precedingRow[element];
      }
    }

    results.push({
      index: idx,
      rowIndex: sample.rowIndex,
      sampleId: sample.sampleId,
      value,
      detectionLimit,
      status,
      multipleOfDL,
      adjustedValue,
      precedingSampleId,
      precedingSampleValue,
    });
  });

  if (results.length === 0) return null;

  // If no DL provided, evaluate statistically
  if (!detectionLimit) {
    const statValues = results.map(r => r.adjustedValue ?? r.value);
    const meanVal = mean(statValues);
    const sdVal = standardDeviation(statValues);
    const statThreshold = meanVal + 3 * sdVal;

    results.forEach(r => {
      const v = r.adjustedValue ?? r.value;
      if (v > statThreshold) {
        r.status = 'contaminated';
      } else if (v > meanVal + 2 * sdVal) {
        r.status = 'elevated';
      }
    });
  }

  // Count contamination events (contaminated blank after high-grade sample)
  let contaminationEvents = 0;
  results.forEach(r => {
    if (r.status === 'contaminated' && r.precedingSampleValue !== undefined) {
      // Check if preceding sample was high-grade (>10× blank value)
      if (r.precedingSampleValue > r.value * 10) {
        contaminationEvents++;
      }
    }
  });

  const cleanCount = results.filter(r => r.status === 'clean').length;
  const elevatedCount = results.filter(r => r.status === 'elevated').length;
  const contaminatedCount = results.filter(r => r.status === 'contaminated').length;
  // Use adjusted values for stats where available
  const values = results.map(r => r.adjustedValue ?? r.value);

  return {
    element,
    detectionLimit,
    results,
    cleanCount,
    elevatedCount,
    contaminatedCount,
    maxValue: Math.max(...values),
    meanValue: mean(values),
    contaminationEvents,
  };
}

// ============================================================================
// THOMPSON-HOWARTH PRECISION ANALYSIS (Feature 2.3)
// ============================================================================

/**
 * Thompson-Howarth precision analysis.
 * Bins duplicate pairs by concentration, calculates precision per bin,
 * and fits a log-log regression. Industry standard for JORC/NI 43-101.
 */
export function thompsonHowarthAnalysis(
  results: DuplicateResult[],
  numBins: number = 6
): ThompsonHowarthResult | null {
  // Filter out BDL pairs
  const validResults = results.filter(r => !r.belowDetection && r.mean > 0);
  if (validResults.length < 6) return null;

  // Sort by mean concentration
  const sorted = [...validResults].sort((a, b) => a.mean - b.mean);

  // Divide into approximately equal bins
  const binSize = Math.max(3, Math.floor(sorted.length / numBins));
  const bins: ThompsonHowarthBin[] = [];

  for (let i = 0; i < sorted.length; i += binSize) {
    const binResults = sorted.slice(i, Math.min(i + binSize, sorted.length));
    if (binResults.length < 2) continue;

    const concentrations = binResults.map(r => r.mean);
    const meanConcentration = mean(concentrations);

    // Calculate precision for this bin: s = sqrt(Sum(d^2) / 2n)
    const differences = binResults.map(r => r.originalValue - r.duplicateValue);
    const sumSquaredDiffs = differences.reduce((sum, d) => sum + d * d, 0);
    const binPrecision = Math.sqrt(sumSquaredDiffs / (2 * binResults.length));

    bins.push({
      concentrationRange: [Math.min(...concentrations), Math.max(...concentrations)],
      meanConcentration,
      precision: binPrecision,
      pairCount: binResults.length,
    });
  }

  if (bins.length < 3) return null;

  // Fit log-log regression: log(precision) = slope * log(concentration) + intercept
  const logConc = bins.filter(b => b.meanConcentration > 0 && b.precision > 0)
    .map(b => Math.log10(b.meanConcentration));
  const logPrec = bins.filter(b => b.meanConcentration > 0 && b.precision > 0)
    .map(b => Math.log10(b.precision));

  if (logConc.length < 3) return { bins, slope: 0, intercept: 0, r2: 0 };

  // Simple linear regression on log-log
  const n = logConc.length;
  const sumX = logConc.reduce((a, b) => a + b, 0);
  const sumY = logPrec.reduce((a, b) => a + b, 0);
  const sumXY = logConc.reduce((acc, x, i) => acc + x * logPrec[i], 0);
  const sumX2 = logConc.reduce((acc, x) => acc + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R-squared
  const ssRes = logConc.reduce((acc, x, i) => {
    const predicted = slope * x + intercept;
    return acc + Math.pow(logPrec[i] - predicted, 2);
  }, 0);
  const ssTot = logPrec.reduce((acc, y) => {
    return acc + Math.pow(y - sumY / n, 2);
  }, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { bins, slope, intercept, r2 };
}

// ============================================================================
// SUMMARY CALCULATIONS
// ============================================================================

/**
 * Calculate overall QC grade for an element.
 * Fix 1.5: Only weight QC types that have data. Apply coverage penalty for missing types.
 */
export function calculateElementGrade(
  standardPassRate: number,
  blankPassRate: number,
  duplicatePassRate: number,
  hasStandards: boolean = true,
  hasBlanks: boolean = true,
  hasDuplicates: boolean = true
): 'A' | 'B' | 'C' | 'D' | 'F' {
  const score = calculateOverallScore(
    standardPassRate, blankPassRate, duplicatePassRate,
    hasStandards, hasBlanks, hasDuplicates
  );

  if (score >= 95) return 'A';
  if (score >= 85) return 'B';
  if (score >= 75) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Calculate overall score (0-100).
 * Fix 1.5: Only weight QC types that have data. Elements with no data for a type
 * get a coverage penalty rather than a free 100%.
 */
export function calculateOverallScore(
  standardPassRate: number,
  blankPassRate: number,
  duplicatePassRate: number,
  hasStandards: boolean = true,
  hasBlanks: boolean = true,
  hasDuplicates: boolean = true
): number {
  // Standard weights: standards 0.4, duplicates 0.35, blanks 0.25
  let totalWeight = 0;
  let weightedSum = 0;

  if (hasStandards) {
    weightedSum += standardPassRate * 0.4;
    totalWeight += 0.4;
  }
  if (hasDuplicates) {
    weightedSum += duplicatePassRate * 0.35;
    totalWeight += 0.35;
  }
  if (hasBlanks) {
    weightedSum += blankPassRate * 0.25;
    totalWeight += 0.25;
  }

  if (totalWeight === 0) return 0; // No data at all

  // Base score from available types
  let score = weightedSum / totalWeight;

  // Coverage penalty: deduct 5 points for each missing QC type
  const missingTypes = [hasStandards, hasBlanks, hasDuplicates].filter(h => !h).length;
  score = Math.max(0, score - missingTypes * 5);

  return score;
}

/**
 * Generate recommendations based on QC results
 */
export function generateRecommendations(
  elementSummaries: ElementQCSummary[]
): string[] {
  const recommendations: string[] = [];

  // Check for elements with low standard pass rates
  const lowStandardElements = elementSummaries.filter(e => e.hasStandards && e.standardsPassRate < 85);
  if (lowStandardElements.length > 0) {
    recommendations.push(
      `Standards for ${lowStandardElements.map(e => e.element).join(', ')} show poor accuracy. Consider recalibration or method review.`
    );
  }

  // Check for elements with high blank contamination
  const contaminatedElements = elementSummaries.filter(e => e.hasBlanks && e.blanksPassRate < 90);
  if (contaminatedElements.length > 0) {
    recommendations.push(
      `Blank contamination detected for ${contaminatedElements.map(e => e.element).join(', ')}. Review sample preparation procedures.`
    );
  }

  // Check for elements with poor duplicate precision
  const poorPrecisionElements = elementSummaries.filter(e => e.hasDuplicates && e.duplicatesPassRate < 80);
  if (poorPrecisionElements.length > 0) {
    recommendations.push(
      `Poor duplicate precision for ${poorPrecisionElements.map(e => e.element).join(', ')}. Check for nugget effect or sampling heterogeneity.`
    );
  }

  // Check overall insertion rate
  const totalQC = elementSummaries.reduce((sum, e) =>
    sum + e.standardsAnalyzed + e.blanksAnalyzed + e.duplicatesAnalyzed, 0
  );
  const avgAnalyzed = elementSummaries.length > 0 ? totalQC / elementSummaries.length : 0;

  if (avgAnalyzed < 10) {
    recommendations.push(
      'Low QC sample count. Consider increasing QC insertion rate to minimum 5% of total samples.'
    );
  }

  // Add grade-specific recommendations
  const overallGrades = elementSummaries.map(e => e.grade);
  const fGrades = overallGrades.filter(g => g === 'F').length;
  const dGrades = overallGrades.filter(g => g === 'D').length;

  if (fGrades > 0) {
    recommendations.push(
      `${fGrades} element(s) received failing QC grades. Data quality may be compromised - use with caution.`
    );
  } else if (dGrades > 0) {
    recommendations.push(
      `${dGrades} element(s) received marginal QC grades. Review flagged batches before interpretation.`
    );
  } else if (recommendations.length === 0) {
    recommendations.push(
      'QA/QC results are satisfactory. Data quality is acceptable for interpretation.'
    );
  }

  return recommendations;
}
