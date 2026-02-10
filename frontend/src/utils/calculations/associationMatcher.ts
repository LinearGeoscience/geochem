/**
 * Element Association Pattern Matching Algorithm
 *
 * Matches PCA-derived element associations against reference patterns
 * to identify likely geological interpretations (lithological, regolith,
 * alteration, or mineralisation signatures).
 *
 * Based on "Interpreting Element Associations" geochemistry methodology.
 */

import {
  ElementAssociationPattern,
  MatchScore,
  ExtractedAssociation,
  PCAssociationAnalysis,
  QualityAssessment,
  MatchingOptions,
  ScoringConfig,
  ElementLoading,
  LITHOPHILE_ELEMENTS
} from '../../types/associations';

import {
  REFERENCE_PATTERNS,
  DISCRIMINATION_RULES,
  DEFAULT_SCORING_CONFIG
} from '../../data/elementAssociationPatterns';

import { FullPCAResult, SortedLoading } from './pcaAnalysis';

// ============================================================================
// DEFAULT OPTIONS
// ============================================================================

const DEFAULT_MATCHING_OPTIONS: MatchingOptions & { elementMapping?: Map<string, string> } = {
  loadingThreshold: 0.3,
  maxMatches: 5,
  minimumConfidence: 25,
  applyDiscrimination: true,
  elementMapping: undefined
};

// Near-threshold range for partial element matching
const NEAR_THRESHOLD_MIN = 0.2;
const PARTIAL_MATCH_WEIGHT = 0.5;

// Loading coherence thresholds - penalize matches where elements are spread out
const LOADING_COHERENCE_THRESHOLD = 0.3; // Max loading range for "tight" cluster
const LOADING_COHERENCE_PENALTY_MAX = 0.6; // Max penalty multiplier (60% reduction)

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

/**
 * Extract elements from one end of a principal component
 * based on loading threshold
 */
export function extractAssociation(
  sortedLoadings: SortedLoading[],
  end: 'positive' | 'negative',
  threshold: number = 0.3
): ExtractedAssociation {
  const elements: ElementLoading[] = [];

  for (const sl of sortedLoadings) {
    if (end === 'positive' && sl.loading >= threshold) {
      elements.push({ element: sl.element, loading: sl.loading });
    } else if (end === 'negative' && sl.loading <= -threshold) {
      elements.push({ element: sl.element, loading: sl.loading });
    }
  }

  // For negative end, reverse so strongest (most negative) is first
  if (end === 'negative') {
    elements.reverse();
  }

  const absLoadings = elements.map(e => Math.abs(e.loading));
  const avgMagnitude = absLoadings.length > 0
    ? absLoadings.reduce((a, b) => a + b, 0) / absLoadings.length
    : 0;
  const maxMagnitude = absLoadings.length > 0
    ? Math.max(...absLoadings)
    : 0;

  return {
    elements,
    end,
    averageLoadingMagnitude: avgMagnitude,
    maxLoadingMagnitude: maxMagnitude
  };
}

/**
 * Convert element loadings to simple element symbol set for matching
 * Applies element mapping if provided to translate column names to element symbols
 */
function getElementSet(
  association: ExtractedAssociation,
  elementMapping?: Map<string, string>
): Set<string> {
  return new Set(association.elements.map(e => {
    // If mapping exists, use it to translate column name to element symbol
    if (elementMapping?.has(e.element)) {
      return elementMapping.get(e.element)!;
    }
    return e.element;
  }));
}

/**
 * Get elements with near-threshold loadings (for partial matching)
 */
function getNearThresholdElements(
  sortedLoadings: SortedLoading[],
  end: 'positive' | 'negative',
  threshold: number,
  elementMapping?: Map<string, string>
): Set<string> {
  const elements = new Set<string>();
  const minThreshold = Math.max(NEAR_THRESHOLD_MIN, threshold - 0.1);

  for (const sl of sortedLoadings) {
    const absLoading = Math.abs(sl.loading);
    const isCorrectEnd = end === 'positive' ? sl.loading > 0 : sl.loading < 0;

    if (isCorrectEnd && absLoading >= minThreshold && absLoading < threshold) {
      const symbol = elementMapping?.has(sl.element)
        ? elementMapping.get(sl.element)!
        : sl.element;
      elements.add(symbol);
    }
  }

  return elements;
}

/**
 * Get element loading by name
 * Supports reverse lookup using element mapping
 */
function getElementLoading(
  association: ExtractedAssociation,
  element: string,
  elementMapping?: Map<string, string>
): number | null {
  // Direct lookup
  let found = association.elements.find(e => e.element === element);

  // If not found and we have a mapping, try reverse lookup
  if (!found && elementMapping) {
    // Find the original column name that maps to this element
    for (const [originalName, mappedElement] of elementMapping.entries()) {
      if (mappedElement === element) {
        found = association.elements.find(e => e.element === originalName);
        if (found) break;
      }
    }
  }

  return found ? found.loading : null;
}

/**
 * Calculate loading coherence penalty for matched elements
 *
 * Elements that are truly associated should have similar loadings.
 * If matched elements are spread across a wide loading range with gaps,
 * they're not actually behaving as a coherent group in this PC.
 *
 * @returns A penalty multiplier between 0 (no penalty) and LOADING_COHERENCE_PENALTY_MAX
 */
function calculateLoadingCoherencePenalty(
  matchedElements: string[],
  association: ExtractedAssociation,
  elementMapping?: Map<string, string>
): number {
  if (matchedElements.length < 2) {
    return 0; // No penalty for single element matches
  }

  // Get loadings for all matched elements
  const loadings: number[] = [];
  for (const element of matchedElements) {
    const loading = getElementLoading(association, element, elementMapping);
    if (loading !== null) {
      loadings.push(Math.abs(loading));
    }
  }

  if (loadings.length < 2) {
    return 0;
  }

  // Calculate loading range (spread)
  const minLoading = Math.min(...loadings);
  const maxLoading = Math.max(...loadings);
  const loadingRange = maxLoading - minLoading;

  // Calculate penalty based on how spread out the elements are
  // A tight cluster (range < 0.3) gets no penalty
  // A spread cluster (range > 0.6) gets maximum penalty
  if (loadingRange <= LOADING_COHERENCE_THRESHOLD) {
    return 0;
  }

  // Linear interpolation between threshold and 2x threshold
  const excessRange = loadingRange - LOADING_COHERENCE_THRESHOLD;
  const penaltyFraction = Math.min(1, excessRange / LOADING_COHERENCE_THRESHOLD);

  return penaltyFraction * LOADING_COHERENCE_PENALTY_MAX;
}

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Score a single pattern against an element association
 *
 * @param association - The extracted element association from PCA
 * @param pattern - The reference pattern to match against
 * @param config - Scoring configuration weights and thresholds
 * @param elementMapping - Map from column names to element symbols
 * @param nearThresholdElements - Elements with near-threshold loadings for partial matching
 * @param availableElements - Set of all elements available in the dataset (for fair scoring)
 */
export function scorePattern(
  association: ExtractedAssociation,
  pattern: ElementAssociationPattern,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  elementMapping?: Map<string, string>,
  nearThresholdElements?: Set<string>,
  availableElements?: Set<string>
): MatchScore {
  const elementSet = getElementSet(association, elementMapping);

  // Filter pattern elements to only those available in the dataset
  // If availableElements is not provided, assume all elements are available (backwards compatible)
  const availableCoreElements = availableElements
    ? pattern.coreElements.filter(e => availableElements.has(e))
    : pattern.coreElements;

  const availableCommonElements = availableElements
    ? pattern.commonElements.filter(e => availableElements.has(e))
    : pattern.commonElements;

  // Track unavailable elements separately (not measured in dataset)
  const unavailableCoreElements = availableElements
    ? pattern.coreElements.filter(e => !availableElements.has(e))
    : [];

  const unavailableCommonElements = availableElements
    ? pattern.commonElements.filter(e => !availableElements.has(e))
    : [];

  // Find matched elements in each tier (only from available elements)
  const matchedCoreElements = availableCoreElements.filter(e => elementSet.has(e));
  const matchedCommonElements = availableCommonElements.filter(e => elementSet.has(e));
  const matchedOptionalElements = pattern.optionalElements.filter(e => elementSet.has(e));
  const presentAntiElements = pattern.antiElements.filter(e => elementSet.has(e));

  // Missing elements are those available but not matched (different from unavailable)
  const missingCoreElements = availableCoreElements.filter(e => !elementSet.has(e));

  // Check for near-threshold elements that partially match core elements (only available ones)
  let partialCoreBonus = 0;
  if (nearThresholdElements && nearThresholdElements.size > 0) {
    const partialCoreMatches = availableCoreElements.filter(e =>
      nearThresholdElements.has(e) && !elementSet.has(e)
    );
    if (partialCoreMatches.length > 0 && availableCoreElements.length > 0) {
      partialCoreBonus = (partialCoreMatches.length * PARTIAL_MATCH_WEIGHT) / availableCoreElements.length;
    }
  }

  // Calculate tier scores (as fractions) using only AVAILABLE elements in denominator
  // This ensures patterns aren't penalized for elements that weren't measured
  const coreMatchFraction = availableCoreElements.length > 0
    ? matchedCoreElements.length / availableCoreElements.length
    : 0;

  const commonMatchFraction = availableCommonElements.length > 0
    ? matchedCommonElements.length / availableCommonElements.length
    : 0;

  const optionalMatchFraction = pattern.optionalElements.length > 0
    ? matchedOptionalElements.length / pattern.optionalElements.length
    : 0;

  // Calculate effective core match including partial bonus
  const effectiveCoreMatchFraction = coreMatchFraction + partialCoreBonus;

  // Check minimum core match requirement (use effective fraction for threshold check)
  // Only apply if we have available core elements to match
  if (availableCoreElements.length > 0 && effectiveCoreMatchFraction < pattern.minimumCoreMatch) {
    // Below minimum threshold - return zero score
    return {
      patternId: pattern.id,
      patternName: pattern.name,
      category: pattern.category,
      confidenceScore: 0,
      coreMatchScore: 0,
      commonMatchScore: 0,
      optionalMatchScore: 0,
      antiElementPenalty: 0,
      loadingStrengthBonus: 0,
      matchedCoreElements,
      matchedCommonElements,
      matchedOptionalElements,
      presentAntiElements,
      missingCoreElements,
      unavailableCoreElements,
      unavailableCommonElements,
      patternCompleteness: 0,
      associationPurity: 0,
      lithophileInterference: false
    };
  }

  // Calculate base scores (0-100 scale for each component)
  // Use effective fraction for core score to include partial matches
  const coreMatchScore = Math.min(100, effectiveCoreMatchFraction * 100);
  const commonMatchScore = commonMatchFraction * 100;
  const optionalMatchScore = optionalMatchFraction * 100;

  // Anti-element penalty (per element)
  const antiElementPenalty = presentAntiElements.length * config.antiElementPenalty * 100;

  // Loading strength bonus based on average magnitude
  let loadingStrengthBonus = 0;
  if (association.averageLoadingMagnitude >= config.loadingThresholdStrong) {
    loadingStrengthBonus = 100; // Full bonus for strong loadings
  } else if (association.averageLoadingMagnitude >= config.loadingThresholdModerate) {
    loadingStrengthBonus = 50; // Half bonus for moderate loadings
  }

  // Calculate weighted confidence score
  const rawScore =
    (coreMatchScore * config.coreWeight) +
    (commonMatchScore * config.commonWeight) +
    (optionalMatchScore * config.optionalWeight) +
    (loadingStrengthBonus * config.loadingStrengthWeight) -
    antiElementPenalty;

  // Apply loading coherence penalty
  // Elements that are spread out across the loading range (not truly associated)
  // should have reduced confidence
  const allMatchedElements = [...matchedCoreElements, ...matchedCommonElements];
  const coherencePenalty = calculateLoadingCoherencePenalty(
    allMatchedElements,
    association,
    elementMapping
  );

  // Apply penalty as a multiplier (e.g., 40% penalty reduces score by 40%)
  const penalizedScore = rawScore * (1 - coherencePenalty);

  // Clamp to 0-100
  const confidenceScore = Math.max(0, Math.min(100, penalizedScore));

  // Quality metrics - use available elements for accurate completeness calculation
  const totalAvailablePatternElements = availableCoreElements.length +
    availableCommonElements.length + pattern.optionalElements.length;
  const totalMatchedElements = matchedCoreElements.length +
    matchedCommonElements.length + matchedOptionalElements.length;

  const patternCompleteness = totalAvailablePatternElements > 0
    ? (totalMatchedElements / totalAvailablePatternElements) * 100
    : 0;

  const associationPurity = elementSet.size > 0
    ? (totalMatchedElements / elementSet.size) * 100
    : 0;

  // Check for lithophile interference (for mineralisation patterns)
  const lithophileInterference = pattern.category === 'mineralisation' &&
    LITHOPHILE_ELEMENTS.some(e => elementSet.has(e));

  return {
    patternId: pattern.id,
    patternName: pattern.name,
    category: pattern.category,
    confidenceScore,
    coreMatchScore,
    commonMatchScore,
    optionalMatchScore,
    antiElementPenalty,
    loadingStrengthBonus,
    matchedCoreElements,
    matchedCommonElements,
    matchedOptionalElements,
    presentAntiElements,
    missingCoreElements,
    unavailableCoreElements,
    unavailableCommonElements,
    patternCompleteness,
    associationPurity,
    lithophileInterference
  };
}

/**
 * Score association against all reference patterns
 */
export function scoreAllPatterns(
  association: ExtractedAssociation,
  patterns: ElementAssociationPattern[] = REFERENCE_PATTERNS,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  elementMapping?: Map<string, string>,
  nearThresholdElements?: Set<string>,
  availableElements?: Set<string>
): MatchScore[] {
  const scores = patterns.map(pattern =>
    scorePattern(association, pattern, config, elementMapping, nearThresholdElements, availableElements)
  );

  // Sort by confidence score (highest first)
  scores.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return scores;
}

// ============================================================================
// DISCRIMINATION LOGIC
// ============================================================================

/**
 * Apply discrimination rules to refine scores for similar patterns
 *
 * When two similar patterns both score highly, use discriminating elements
 * to adjust relative scores.
 */
export function applyDiscriminationRules(
  scores: MatchScore[],
  association: ExtractedAssociation,
  elementMapping?: Map<string, string>
): MatchScore[] {
  // Create a copy to modify
  const refined = scores.map(s => ({ ...s }));

  // For each discrimination rule
  for (const rule of DISCRIMINATION_RULES) {
    const idx1 = refined.findIndex(s => s.patternId === rule.pattern1);
    const idx2 = refined.findIndex(s => s.patternId === rule.pattern2);

    // Only apply if both patterns are in the results with significant scores
    if (idx1 === -1 || idx2 === -1) continue;
    if (refined[idx1].confidenceScore < 25 || refined[idx2].confidenceScore < 25) continue;

    // Skip if rule requires context
    if (rule.requiresContext) continue;

    // Apply discrimination based on element loadings
    let bonus1 = 0;
    let bonus2 = 0;

    for (const discEl of rule.discriminators) {
      const loading = getElementLoading(association, discEl, elementMapping);
      if (loading === null) continue;

      // Check which pattern the element supports
      const pattern1 = REFERENCE_PATTERNS.find(p => p.id === rule.pattern1);
      const pattern2 = REFERENCE_PATTERNS.find(p => p.id === rule.pattern2);

      if (!pattern1 || !pattern2) continue;

      const inPattern1Core = pattern1.coreElements.includes(discEl);
      const inPattern1Common = pattern1.commonElements.includes(discEl);
      const inPattern2Core = pattern2.coreElements.includes(discEl);
      const inPattern2Common = pattern2.commonElements.includes(discEl);

      // Discriminating element favors one pattern
      const loadingStrength = Math.abs(loading);
      if (inPattern1Core && !inPattern2Core) {
        bonus1 += loadingStrength * 5;
      } else if (inPattern2Core && !inPattern1Core) {
        bonus2 += loadingStrength * 5;
      } else if (inPattern1Core && inPattern2Common) {
        bonus1 += loadingStrength * 2;
      } else if (inPattern2Core && inPattern1Common) {
        bonus2 += loadingStrength * 2;
      }
    }

    // Apply bonuses (capped adjustment)
    refined[idx1].confidenceScore = Math.min(100, refined[idx1].confidenceScore + bonus1);
    refined[idx2].confidenceScore = Math.min(100, refined[idx2].confidenceScore + bonus2);
  }

  // Re-sort after adjustments
  refined.sort((a, b) => b.confidenceScore - a.confidenceScore);

  return refined;
}

// ============================================================================
// QUALITY ASSESSMENT
// ============================================================================

/**
 * Assess quality of a PC's association analysis
 */
export function assessQuality(
  positiveAssoc: ExtractedAssociation,
  negativeAssoc: ExtractedAssociation,
  positiveMatches: MatchScore[],
  negativeMatches: MatchScore[]
): QualityAssessment {
  const notes: string[] = [];

  // Check mineralisation independence
  const topPositive = positiveMatches[0];
  const topNegative = negativeMatches[0];

  let mineralisationIndependent = true;

  // If top match is mineralisation, check for lithophile interference
  if (topPositive?.category === 'mineralisation' && topPositive.lithophileInterference) {
    mineralisationIndependent = false;
    notes.push('Positive mineralisation signature contains lithophile elements - may be influenced by host rock');
  }
  if (topNegative?.category === 'mineralisation' && topNegative.lithophileInterference) {
    mineralisationIndependent = false;
    notes.push('Negative mineralisation signature contains lithophile elements - may be influenced by host rock');
  }

  if (topPositive?.category === 'mineralisation' && !topPositive.lithophileInterference) {
    notes.push('Mineralisation signature independent of lithophile elements');
  }

  // Check loading strength
  const strongLoadings =
    positiveAssoc.averageLoadingMagnitude >= 0.5 ||
    negativeAssoc.averageLoadingMagnitude >= 0.5;

  if (strongLoadings) {
    notes.push('Strong loading magnitudes (>0.5)');
  } else if (positiveAssoc.averageLoadingMagnitude >= 0.3 ||
             negativeAssoc.averageLoadingMagnitude >= 0.3) {
    notes.push('Moderate loading magnitudes');
  } else {
    notes.push('Weak loading magnitudes - interpretations less certain');
  }

  // Check for clear separation (one end mineralisation, other lithological)
  const clearSeparation =
    (topPositive?.category === 'mineralisation' && topNegative?.category === 'lithological') ||
    (topNegative?.category === 'mineralisation' && topPositive?.category === 'lithological');

  if (clearSeparation) {
    notes.push('Clear separation between ore and host rock signatures');
  }

  // Check for mixed regolith signatures
  if (topPositive?.category === 'regolith' || topNegative?.category === 'regolith') {
    const regolithMatches = [...positiveMatches, ...negativeMatches].filter(
      m => m.category === 'regolith' && m.confidenceScore > 40
    );
    if (regolithMatches.length > 0) {
      notes.push('Regolith influence detected - consider weathering effects on primary signatures');
    }
  }

  return {
    mineralisationIndependent,
    strongLoadings,
    clearSeparation,
    notes
  };
}

// ============================================================================
// MAIN MATCHING FUNCTION
// ============================================================================

/**
 * Match associations for a single principal component
 *
 * @param sortedLoadings - Loadings sorted by value
 * @param pcNumber - Principal component number (1-indexed)
 * @param varianceExplained - Percentage of variance explained by this PC
 * @param options - Matching options including element mapping
 * @param availableElements - Optional set of all elements available in the dataset
 */
export function matchPCAssociations(
  sortedLoadings: SortedLoading[],
  pcNumber: number,
  varianceExplained: number,
  options: MatchingOptions = {},
  availableElements?: Set<string>
): PCAssociationAnalysis {
  const opts = { ...DEFAULT_MATCHING_OPTIONS, ...options };
  const elementMapping = opts.elementMapping;

  // Build available elements set from the data if not provided
  // This ensures patterns aren't penalized for unmeasured elements
  const effectiveAvailableElements = availableElements ?? new Set(
    sortedLoadings.map(sl => {
      // Use element mapping if available, otherwise use the original column name
      return elementMapping?.get(sl.element) ?? sl.element;
    })
  );

  // Extract positive and negative associations
  const positiveAssoc = extractAssociation(sortedLoadings, 'positive', opts.loadingThreshold);
  const negativeAssoc = extractAssociation(sortedLoadings, 'negative', opts.loadingThreshold);

  // Get near-threshold elements for partial matching
  const positiveNearThreshold = getNearThresholdElements(
    sortedLoadings, 'positive', opts.loadingThreshold ?? 0.3, elementMapping
  );
  const negativeNearThreshold = getNearThresholdElements(
    sortedLoadings, 'negative', opts.loadingThreshold ?? 0.3, elementMapping
  );

  // Score against all patterns, passing available elements for fair scoring
  let positiveMatches = scoreAllPatterns(
    positiveAssoc, REFERENCE_PATTERNS, DEFAULT_SCORING_CONFIG,
    elementMapping, positiveNearThreshold, effectiveAvailableElements
  );
  let negativeMatches = scoreAllPatterns(
    negativeAssoc, REFERENCE_PATTERNS, DEFAULT_SCORING_CONFIG,
    elementMapping, negativeNearThreshold, effectiveAvailableElements
  );

  // Apply discrimination rules
  if (opts.applyDiscrimination) {
    positiveMatches = applyDiscriminationRules(positiveMatches, positiveAssoc, elementMapping);
    negativeMatches = applyDiscriminationRules(negativeMatches, negativeAssoc, elementMapping);
  }

  // Filter by minimum confidence and limit results
  const minConfidence = opts.minimumConfidence ?? 25;
  const maxMatches = opts.maxMatches ?? 5;

  positiveMatches = positiveMatches
    .filter(m => m.confidenceScore >= minConfidence)
    .slice(0, maxMatches);

  negativeMatches = negativeMatches
    .filter(m => m.confidenceScore >= minConfidence)
    .slice(0, maxMatches);

  // Build element strings for display (use mapped names if available)
  const positiveElementString = positiveAssoc.elements
    .map(e => elementMapping?.get(e.element) ?? e.element)
    .join('-');

  const negativeElementString = negativeAssoc.elements
    .map(e => elementMapping?.get(e.element) ?? e.element)
    .join('-');

  // Assess quality
  const qualityAssessment = assessQuality(
    positiveAssoc,
    negativeAssoc,
    positiveMatches,
    negativeMatches
  );

  return {
    pcNumber,
    varianceExplained,
    positiveAssociation: {
      association: positiveAssoc,
      matches: positiveMatches,
      elementString: positiveElementString
    },
    negativeAssociation: {
      association: negativeAssoc,
      matches: negativeMatches,
      elementString: negativeElementString
    },
    qualityAssessment
  };
}

/**
 * Match associations for all principal components in a PCA result
 */
export function matchAssociations(
  pcaResult: FullPCAResult,
  options: MatchingOptions = {}
): PCAssociationAnalysis[] {
  const results: PCAssociationAnalysis[] = [];
  const elementMapping = options.elementMapping;

  // Build set of all available elements in the dataset
  // This ensures patterns aren't penalized for unmeasured elements
  const availableElements = new Set<string>();
  for (const column of pcaResult.columns) {
    // Use element mapping if available, otherwise use column name
    const element = elementMapping?.get(column) ?? column;
    availableElements.add(element);
  }

  for (let pc = 0; pc < pcaResult.eigenvalues.length; pc++) {
    // Get sorted loadings for this PC
    const sortedLoadings: SortedLoading[] = pcaResult.columns.map((element, i) => ({
      element,
      loading: pcaResult.loadings[i]?.[pc] ?? 0
    })).sort((a, b) => b.loading - a.loading);

    const analysis = matchPCAssociations(
      sortedLoadings,
      pc + 1, // 1-indexed PC number
      pcaResult.varianceExplained[pc],
      options,
      availableElements
    );

    results.push(analysis);
  }

  return results;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get confidence level label
 */
export function getConfidenceLevel(score: number): 'high' | 'moderate' | 'low' | 'none' {
  if (score >= DEFAULT_SCORING_CONFIG.highConfidence) return 'high';
  if (score >= DEFAULT_SCORING_CONFIG.moderateConfidence) return 'moderate';
  if (score >= DEFAULT_SCORING_CONFIG.lowConfidence) return 'low';
  return 'none';
}

/**
 * Format confidence score for display
 */
export function formatConfidence(score: number): string {
  return `${Math.round(score)}%`;
}

/**
 * Check if an association has meaningful matches
 */
export function hasSignificantMatches(matches: MatchScore[]): boolean {
  return matches.length > 0 && matches[0].confidenceScore >= DEFAULT_SCORING_CONFIG.lowConfidence;
}

/**
 * Get the best match from an association
 */
export function getBestMatch(matches: MatchScore[]): MatchScore | null {
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Summary of all PC associations for quick overview
 */
export interface AssociationSummary {
  pcNumber: number;
  varianceExplained: number;
  positiveInterpretation: string;
  positiveConfidence: number;
  positiveCategory: string;
  negativeInterpretation: string;
  negativeConfidence: number;
  negativeCategory: string;
  hasMineralisation: boolean;
}

/**
 * Generate summary of all association analyses
 */
export function summarizeAssociations(
  analyses: PCAssociationAnalysis[]
): AssociationSummary[] {
  return analyses.map(analysis => {
    const posBest = getBestMatch(analysis.positiveAssociation.matches);
    const negBest = getBestMatch(analysis.negativeAssociation.matches);

    return {
      pcNumber: analysis.pcNumber,
      varianceExplained: analysis.varianceExplained,
      positiveInterpretation: posBest?.patternName ?? 'No significant match',
      positiveConfidence: posBest?.confidenceScore ?? 0,
      positiveCategory: posBest?.category ?? '',
      negativeInterpretation: negBest?.patternName ?? 'No significant match',
      negativeConfidence: negBest?.confidenceScore ?? 0,
      negativeCategory: negBest?.category ?? '',
      hasMineralisation: posBest?.category === 'mineralisation' || negBest?.category === 'mineralisation'
    };
  });
}

export default {
  extractAssociation,
  scorePattern,
  scoreAllPatterns,
  applyDiscriminationRules,
  assessQuality,
  matchPCAssociations,
  matchAssociations,
  getConfidenceLevel,
  formatConfidence,
  hasSignificantMatches,
  getBestMatch,
  summarizeAssociations
};
