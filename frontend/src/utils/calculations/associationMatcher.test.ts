/**
 * Validation Tests for Association Matcher
 *
 * These tests verify the pattern matching algorithm for element associations.
 * This file can be run standalone or imported for validation.
 *
 * Run with: npx ts-node associationMatcher.test.ts
 * Or import runAllTests() and call it from the browser console.
 */

import {
  extractAssociation,
  scorePattern,
  scoreAllPatterns,
  applyDiscriminationRules,
  matchPCAssociations,
  matchAssociations,
  getConfidenceLevel,
  hasSignificantMatches,
  summarizeAssociations,
} from './associationMatcher';

import {
  REFERENCE_PATTERNS,
  PATTERN_BY_ID,
} from '../../data/elementAssociationPatterns';

import type { SortedLoading } from './pcaAnalysis';
import type { ExtractedAssociation, MatchScore } from '../../types/associations';

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock sorted loadings array for testing
 */
function createMockLoadings(elements: Array<{ element: string; loading: number }>): SortedLoading[] {
  return [...elements].sort((a, b) => b.loading - a.loading);
}

/**
 * Create a mock extracted association
 */
function createMockAssociation(
  elements: string[],
  loadingMagnitude: number = 0.5,
  end: 'positive' | 'negative' = 'positive'
): ExtractedAssociation {
  return {
    elements: elements.map((el, i) => ({
      element: el,
      loading: end === 'positive' ? loadingMagnitude - i * 0.05 : -(loadingMagnitude - i * 0.05),
    })),
    end,
    averageLoadingMagnitude: loadingMagnitude,
    maxLoadingMagnitude: loadingMagnitude,
  };
}

/**
 * Simple assertion helper
 */
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Assert equality
 */
function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

/**
 * Assert greater than
 */
function assertGreaterThan(actual: number, expected: number, message: string): void {
  if (actual <= expected) {
    throw new Error(`${message}: expected ${actual} > ${expected}`);
  }
}

/**
 * Assert array contains
 */
function assertContains<T>(array: T[], item: T, message: string): void {
  if (!array.includes(item)) {
    throw new Error(`${message}: expected array to contain ${item}`);
  }
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

/**
 * Run all validation tests
 */
export function runAllTests(): { passed: number; failed: number; results: TestResult[] } {
  const results: TestResult[] = [];

  function runTest(name: string, testFn: () => void): void {
    try {
      testFn();
      results.push({ name, passed: true });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ name, passed: false, error });
    }
  }

  // ========== EXTRACTION TESTS ==========

  runTest('extractAssociation: extracts positive elements above threshold', () => {
    const loadings = createMockLoadings([
      { element: 'Pb', loading: 0.8 },
      { element: 'Zn', loading: 0.6 },
      { element: 'Cu', loading: 0.4 },
      { element: 'Fe', loading: 0.2 },
      { element: 'Al', loading: -0.3 },
    ]);

    const result = extractAssociation(loadings, 'positive', 0.3);

    assertEqual(result.end, 'positive', 'Should have positive end');
    assertEqual(result.elements.length, 3, 'Should extract 3 elements');
    assertContains(result.elements.map(e => e.element), 'Pb', 'Should contain Pb');
  });

  runTest('extractAssociation: extracts negative elements below threshold', () => {
    const loadings = createMockLoadings([
      { element: 'Pb', loading: 0.8 },
      { element: 'Al', loading: -0.3 },
      { element: 'Ti', loading: -0.5 },
      { element: 'Zr', loading: -0.7 },
    ]);

    const result = extractAssociation(loadings, 'negative', 0.3);

    assertEqual(result.end, 'negative', 'Should have negative end');
    assertEqual(result.elements.length, 3, 'Should extract 3 elements');
  });

  runTest('extractAssociation: handles empty result when below threshold', () => {
    const loadings = createMockLoadings([
      { element: 'Fe', loading: 0.2 },
      { element: 'Al', loading: 0.1 },
    ]);

    const result = extractAssociation(loadings, 'positive', 0.3);
    assertEqual(result.elements.length, 0, 'Should have no elements');
  });

  // ========== SCORING TESTS ==========

  runTest('scorePattern: scores VHMS pattern with matching elements', () => {
    // Updated to match new VHMS core elements: Sn, Bi, In, Au, Ag
    const association = createMockAssociation(['Sn', 'Bi', 'In', 'Au', 'Ag', 'As'], 0.6);
    const pattern = PATTERN_BY_ID['MIN_VHMS'];

    const score = scorePattern(association, pattern);

    assertEqual(score.patternId, 'MIN_VHMS', 'Should match VHMS pattern ID');
    assertContains(score.matchedCoreElements, 'Sn', 'Should match Sn');
    assertGreaterThan(score.confidenceScore, 50, 'Should have >50% confidence');
  });

  runTest('scorePattern: returns zero when below minimum core match', () => {
    // VHMS core elements are now: Sn, Bi, In, Au, Ag (need 40% = 2 of 5)
    const association = createMockAssociation(['Sn'], 0.6);
    const pattern = PATTERN_BY_ID['MIN_VHMS'];

    const score = scorePattern(association, pattern);

    assertEqual(score.confidenceScore, 0, 'Should have 0% confidence');
  });

  runTest('scorePattern: applies anti-element penalty', () => {
    const maficPattern = PATTERN_BY_ID['LITH_MAFIC'];

    const cleanAssoc = createMockAssociation(['Mg', 'Ti', 'Sc', 'Ni', 'Cr', 'V'], 0.6);
    const cleanScore = scorePattern(cleanAssoc, maficPattern);

    const dirtyAssoc = createMockAssociation(['Mg', 'Ti', 'Sc', 'Ni', 'Cr', 'V', 'Pb', 'U'], 0.6);
    const dirtyScore = scorePattern(dirtyAssoc, maficPattern);

    assertContains(dirtyScore.presentAntiElements, 'Pb', 'Should flag Pb as anti-element');
    assert(dirtyScore.confidenceScore < cleanScore.confidenceScore, 'Dirty score should be lower');
  });

  runTest('scorePattern: detects lithophile interference', () => {
    // Updated to include enough VHMS core elements: Sn, Bi, In, Au, Ag
    const association = createMockAssociation(['Sn', 'Bi', 'Au', 'Ag', 'Al', 'Zr'], 0.6);
    const pattern = PATTERN_BY_ID['MIN_VHMS'];

    const score = scorePattern(association, pattern);

    assert(score.lithophileInterference, 'Should detect lithophile interference');
  });

  // ========== ALL PATTERNS TESTS ==========

  runTest('scoreAllPatterns: returns sorted by confidence', () => {
    const association = createMockAssociation(['Pb', 'Zn', 'Cd', 'Ag', 'As', 'Sb'], 0.6);
    const scores = scoreAllPatterns(association, REFERENCE_PATTERNS);

    for (let i = 1; i < scores.length; i++) {
      assert(
        scores[i - 1].confidenceScore >= scores[i].confidenceScore,
        `Score ${i - 1} should be >= score ${i}`
      );
    }
  });

  runTest('scoreAllPatterns: SHMS elements match SHMS highly', () => {
    const association = createMockAssociation(['Pb', 'Zn', 'Cd', 'Ag', 'As', 'Sb', 'Tl'], 0.6);
    const scores = scoreAllPatterns(association, REFERENCE_PATTERNS);
    const shmsScore = scores.find(s => s.patternId === 'MIN_SHMS');

    assert(shmsScore !== undefined, 'Should find SHMS pattern');
    assertGreaterThan(shmsScore!.confidenceScore, 40, 'SHMS should have >40% confidence');
  });

  // ========== DISCRIMINATION TESTS ==========

  runTest('applyDiscriminationRules: discriminates using Tl-Hg', () => {
    const association = createMockAssociation(['Pb', 'Zn', 'Cd', 'Ag', 'Tl', 'Hg'], 0.6);
    const initialScores = scoreAllPatterns(association, REFERENCE_PATTERNS);
    const refined = applyDiscriminationRules(initialScores, association);

    const shmsScore = refined.find(s => s.patternId === 'MIN_SHMS');
    const mvtScore = refined.find(s => s.patternId === 'MIN_MVT');

    if (shmsScore && mvtScore && shmsScore.confidenceScore > 25 && mvtScore.confidenceScore > 25) {
      assert(
        shmsScore.confidenceScore >= mvtScore.confidenceScore,
        'SHMS should score >= MVT with Tl-Hg present'
      );
    }
  });

  // ========== INTEGRATION TESTS ==========

  runTest('matchPCAssociations: matches associations for a single PC', () => {
    const loadings = createMockLoadings([
      { element: 'Pb', loading: 0.8 },
      { element: 'Zn', loading: 0.7 },
      { element: 'Ag', loading: 0.6 },
      { element: 'Fe', loading: 0.1 },
      { element: 'Al', loading: -0.3 },
      { element: 'Ti', loading: -0.4 },
      { element: 'Zr', loading: -0.5 },
    ]);

    const result = matchPCAssociations(loadings, 1, 35.0);

    assertEqual(result.pcNumber, 1, 'PC number should be 1');
    assertEqual(result.varianceExplained, 35.0, 'Variance should be 35%');
    assert(result.positiveAssociation.matches.length > 0, 'Should have positive matches');
  });

  runTest('matchAssociations: matches all PCs from mock PCA result', () => {
    const mockPcaResult = {
      columns: ['Pb', 'Zn', 'Ag', 'Cu', 'Al', 'Ti', 'Zr', 'Fe'],
      loadings: [
        [0.8, -0.3],
        [0.7, -0.2],
        [0.6, -0.1],
        [0.3, 0.7],
        [-0.5, 0.3],
        [-0.6, 0.4],
        [-0.7, 0.2],
        [0.2, 0.8],
      ],
      eigenvalues: [3.5, 1.8],
      varianceExplained: [43.75, 22.5],
      scores: [],
      eigenvectors: [],
      cumulativeVariance: [43.75, 66.25],
      correlationMatrix: [],
      means: [],
      nSamples: 100,
      zerosReplaced: 0,
    };

    const results = matchAssociations(mockPcaResult);

    assertEqual(results.length, 2, 'Should have 2 PCs');
    assertEqual(results[0].pcNumber, 1, 'First should be PC1');
    assertEqual(results[1].pcNumber, 2, 'Second should be PC2');
  });

  // ========== UTILITY TESTS ==========

  runTest('getConfidenceLevel: returns correct levels', () => {
    assertEqual(getConfidenceLevel(85), 'high', '85 should be high');
    assertEqual(getConfidenceLevel(70), 'high', '70 should be high');
    assertEqual(getConfidenceLevel(60), 'moderate', '60 should be moderate');
    assertEqual(getConfidenceLevel(50), 'moderate', '50 should be moderate');
    assertEqual(getConfidenceLevel(40), 'low', '40 should be low');
    assertEqual(getConfidenceLevel(10), 'none', '10 should be none');
  });

  runTest('hasSignificantMatches: returns true for good matches', () => {
    const matches: MatchScore[] = [{
      patternId: 'test',
      patternName: 'Test',
      category: 'mineralisation',
      confidenceScore: 70,
      coreMatchScore: 80,
      commonMatchScore: 50,
      optionalMatchScore: 0,
      antiElementPenalty: 0,
      loadingStrengthBonus: 50,
      matchedCoreElements: ['Pb', 'Zn'],
      matchedCommonElements: [],
      matchedOptionalElements: [],
      presentAntiElements: [],
      missingCoreElements: [],
      patternCompleteness: 70,
      associationPurity: 80,
      lithophileInterference: false,
    }];

    assert(hasSignificantMatches(matches), 'Should have significant matches');
  });

  runTest('hasSignificantMatches: returns false for empty array', () => {
    assert(!hasSignificantMatches([]), 'Empty array should not have significant matches');
  });

  runTest('summarizeAssociations: creates summary', () => {
    const mockPcaResult = {
      columns: ['Pb', 'Zn', 'Al', 'Ti'],
      loadings: [[0.8, 0.3], [0.7, 0.4], [-0.6, 0.5], [-0.5, 0.6]],
      eigenvalues: [2.5, 1.5],
      varianceExplained: [62.5, 37.5],
      scores: [],
      eigenvectors: [],
      cumulativeVariance: [62.5, 100],
      correlationMatrix: [],
      means: [],
      nSamples: 50,
      zerosReplaced: 0,
    };

    const analyses = matchAssociations(mockPcaResult);
    const summary = summarizeAssociations(analyses);

    assertEqual(summary.length, 2, 'Should have 2 summaries');
    assertEqual(summary[0].pcNumber, 1, 'First should be PC1');
  });

  // ========== GEOLOGICAL PATTERN TESTS ==========

  runTest('geological: VHMS signature recognition', () => {
    // Updated to emphasize VHMS core: Sn, Bi, In, Au, Ag
    const vhmsAssoc = createMockAssociation(
      ['Sn', 'Bi', 'In', 'Au', 'Ag', 'As', 'Sb', 'Pb', 'Cu', 'Zn'],
      0.65
    );

    const scores = scoreAllPatterns(vhmsAssoc, REFERENCE_PATTERNS);
    const topMatch = scores[0];

    assert(
      topMatch.patternId === 'MIN_VHMS' || topMatch.patternId === 'MIN_SHMS',
      `Top match should be VHMS or SHMS, got ${topMatch.patternId}`
    );
  });

  runTest('geological: mafic rock signature recognition', () => {
    // Updated core: Mg, Sc, Ni, Cr, V (Ti moved to common)
    const maficAssoc = createMockAssociation(
      ['Mg', 'Sc', 'Ni', 'Cr', 'V', 'Co', 'Fe', 'Ti'],
      0.7
    );

    const scores = scoreAllPatterns(maficAssoc, REFERENCE_PATTERNS);
    const topMatch = scores[0];

    assertEqual(topMatch.category, 'lithological', 'Should be lithological category');
  });

  runTest('geological: porphyry Cu signature recognition', () => {
    const porphyryAssoc = createMockAssociation(['Cu', 'Au', 'Mo', 'Bi', 'Te', 'Ag'], 0.65);
    const scores = scoreAllPatterns(porphyryAssoc, REFERENCE_PATTERNS);
    const porphyryMatch = scores.find(s => s.patternId === 'MIN_PORPHYRY_CU');

    assert(porphyryMatch !== undefined, 'Should find porphyry Cu match');
    assertGreaterThan(porphyryMatch!.confidenceScore, 30, 'Porphyry Cu should have >30% confidence');
  });

  // ========== EDGE CASE TESTS ==========

  runTest('edge case: handles empty element association', () => {
    const emptyAssoc: ExtractedAssociation = {
      elements: [],
      end: 'positive',
      averageLoadingMagnitude: 0,
      maxLoadingMagnitude: 0,
    };

    const scores = scoreAllPatterns(emptyAssoc, REFERENCE_PATTERNS);

    scores.forEach(score => {
      assertEqual(score.confidenceScore, 0, `Pattern ${score.patternId} should have 0 confidence`);
    });
  });

  runTest('edge case: handles elements not in any pattern', () => {
    const unknownAssoc = createMockAssociation(['Xe', 'He', 'Ar'], 0.6);
    const scores = scoreAllPatterns(unknownAssoc, REFERENCE_PATTERNS);

    scores.forEach(score => {
      assertEqual(score.confidenceScore, 0, `Pattern ${score.patternId} should have 0 confidence`);
    });
  });

  // Compile results
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  // Log results
  console.log('\n=== Association Matcher Test Results ===\n');

  results.forEach(r => {
    if (r.passed) {
      console.log(`✓ ${r.name}`);
    } else {
      console.log(`✗ ${r.name}`);
      console.log(`  Error: ${r.error}`);
    }
  });

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);

  return { passed, failed, results };
}

// Export for use as a module
export default { runAllTests };
