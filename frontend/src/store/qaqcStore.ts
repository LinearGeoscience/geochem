/**
 * QA/QC Zustand Store
 * Manages state for QA/QC analysis including detection, control charts, duplicates, and blanks
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  QCSample,
  QCSampleType,
  DuplicatePair,
  ControlChartData,
  DuplicateAnalysis,
  BlankAnalysis,
  QAQCThresholds,
  DEFAULT_QAQC_THRESHOLDS,
  StandardReference,
  ElementQCSummary,
  QAQCReport,
  QCDetectionPattern,
  DEFAULT_QC_PATTERNS,
} from '../types/qaqc';
import {
  detectQCSamples,
  detectDuplicatePairs,
  detectSampleIdColumn,
  assignBatches,
} from '../utils/qaqcDetection';
import {
  buildControlChart,
  analyzeDuplicates,
  analyzeBlanks,
  calculateElementGrade,
  calculateOverallScore,
  generateRecommendations,
} from '../utils/qaqcCalculations';

// ============================================================================
// STATE INTERFACE
// ============================================================================

interface QAQCState {
  // Configuration
  sampleIdColumn: string | null;
  batchColumn: string | null;
  duplicatePairColumn: string | null; // Feature 2.5
  thresholds: QAQCThresholds;
  customPatterns: QCDetectionPattern[];
  standardReferences: StandardReference[];
  detectionLimits: Record<string, number>; // element -> DL

  // Detected samples
  qcSamples: QCSample[];
  duplicatePairs: DuplicatePair[];
  batches: Map<number, string>;

  // Analysis results
  controlCharts: Record<string, ControlChartData[]>; // standardName -> charts for each element
  duplicateAnalyses: Record<string, DuplicateAnalysis[]>; // duplicateType -> analyses
  blankAnalyses: BlankAnalysis[];

  // Summary
  elementSummaries: ElementQCSummary[];
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F' | null;
  recommendations: string[];

  // UI state
  selectedElements: string[];
  selectedStandard: string | null;
  navigateToElement: string | null;
  isAnalysisRunning: boolean;
  lastAnalysisTimestamp: number | null;

  // Actions
  setSampleIdColumn: (column: string | null) => void;
  setBatchColumn: (column: string | null) => void;
  setDuplicatePairColumn: (column: string | null) => void;
  setThresholds: (thresholds: Partial<QAQCThresholds>) => void;
  addStandardReference: (reference: StandardReference) => void;
  removeStandardReference: (id: string) => void;
  setDetectionLimit: (element: string, dl: number) => void;
  setSelectedElements: (elements: string[]) => void;
  setSelectedStandard: (standard: string | null) => void;
  setNavigateToElement: (element: string | null) => void;

  // Detection actions
  detectSamples: (
    data: Record<string, any>[],
    columns: { name: string; type: string }[]
  ) => void;
  manuallyTagSample: (rowIndex: number, qcType: QCSampleType | null) => void;
  updateDuplicatePair: (
    originalIndex: number,
    duplicateIndex: number,
    duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate'
  ) => void;

  // Analysis actions
  runAnalysis: (
    data: Record<string, any>[],
    elements: string[]
  ) => void;
  clearAnalysis: () => void;

  // Export
  generateReport: (datasetName: string) => QAQCReport | null;
  reset: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  sampleIdColumn: null as string | null,
  batchColumn: null as string | null,
  duplicatePairColumn: null as string | null,
  thresholds: DEFAULT_QAQC_THRESHOLDS,
  customPatterns: [] as QCDetectionPattern[],
  standardReferences: [] as StandardReference[],
  detectionLimits: {} as Record<string, number>,
  qcSamples: [] as QCSample[],
  duplicatePairs: [] as DuplicatePair[],
  batches: new Map<number, string>(),
  controlCharts: {} as Record<string, ControlChartData[]>,
  duplicateAnalyses: {} as Record<string, DuplicateAnalysis[]>,
  blankAnalyses: [] as BlankAnalysis[],
  elementSummaries: [] as ElementQCSummary[],
  overallGrade: null as 'A' | 'B' | 'C' | 'D' | 'F' | null,
  recommendations: [] as string[],
  selectedElements: [] as string[],
  selectedStandard: null as string | null,
  navigateToElement: null as string | null,
  isAnalysisRunning: false,
  lastAnalysisTimestamp: null as number | null,
};

// ============================================================================
// STORE
// ============================================================================

export const useQAQCStore = create<QAQCState>()(
  persist(
    (set, get) => ({
      ...initialState,

      // Configuration setters
      setSampleIdColumn: (column) => set({ sampleIdColumn: column }),
      setBatchColumn: (column) => set({ batchColumn: column }),
      setDuplicatePairColumn: (column) => set({ duplicatePairColumn: column }),

      setThresholds: (newThresholds) =>
        set((state) => ({
          thresholds: { ...state.thresholds, ...newThresholds },
        })),

      addStandardReference: (reference) =>
        set((state) => ({
          standardReferences: [...state.standardReferences.filter(r => r.id !== reference.id), reference],
        })),

      removeStandardReference: (id) =>
        set((state) => ({
          standardReferences: state.standardReferences.filter(r => r.id !== id),
        })),

      setDetectionLimit: (element, dl) =>
        set((state) => ({
          detectionLimits: { ...state.detectionLimits, [element]: dl },
        })),

      setSelectedElements: (elements) => set({ selectedElements: elements }),
      setSelectedStandard: (standard) => set({ selectedStandard: standard }),
      setNavigateToElement: (element) => set({ navigateToElement: element }),

      // Detection
      detectSamples: (data, columns) => {
        const state = get();

        // Auto-detect sample ID column if not set
        let sampleIdCol = state.sampleIdColumn;
        if (!sampleIdCol) {
          sampleIdCol = detectSampleIdColumn(columns);
          if (!sampleIdCol) {
            console.warn('Could not detect sample ID column');
            return;
          }
        }

        // Get patterns (custom + defaults)
        const patterns = [...state.customPatterns, ...DEFAULT_QC_PATTERNS];

        // Detect QC samples
        const qcSamples = detectQCSamples(data, sampleIdCol, patterns);

        // Detect duplicate pairs for each type (Feature 2.5: pass pair column if set)
        const pairCol = state.duplicatePairColumn || undefined;
        const fieldDuplicates = detectDuplicatePairs(data, sampleIdCol, 'field_duplicate', pairCol);
        const pulpDuplicates = detectDuplicatePairs(data, sampleIdCol, 'pulp_duplicate', pairCol);
        const coreDuplicates = detectDuplicatePairs(data, sampleIdCol, 'core_duplicate', pairCol);
        const allPairs = [...fieldDuplicates, ...pulpDuplicates, ...coreDuplicates];

        // Assign batches
        const batches = assignBatches(data, sampleIdCol, state.batchColumn || undefined);

        // Update QC samples with batch info
        qcSamples.forEach((sample) => {
          sample.batchId = batches.get(sample.rowIndex);
        });

        set({
          sampleIdColumn: sampleIdCol,
          qcSamples,
          duplicatePairs: allPairs,
          batches,
        });
      },

      manuallyTagSample: (rowIndex, qcType) => {
        set((state) => {
          const existing = state.qcSamples.find(s => s.rowIndex === rowIndex);

          if (qcType === null) {
            // Remove the tag
            return {
              qcSamples: state.qcSamples.filter(s => s.rowIndex !== rowIndex),
            };
          }

          if (existing) {
            // Update existing
            return {
              qcSamples: state.qcSamples.map(s =>
                s.rowIndex === rowIndex
                  ? { ...s, qcType, isManuallyTagged: true }
                  : s
              ),
            };
          }

          // Add new
          const newSample: QCSample = {
            rowIndex,
            sampleId: `Manual_${rowIndex}`,
            qcType,
            isManuallyTagged: true,
          };

          return {
            qcSamples: [...state.qcSamples, newSample],
          };
        });
      },

      updateDuplicatePair: (originalIndex, duplicateIndex, duplicateType) => {
        set((state) => {
          const existing = state.duplicatePairs.find(
            p => p.originalIndex === originalIndex && p.duplicateIndex === duplicateIndex
          );

          if (existing) {
            return {
              duplicatePairs: state.duplicatePairs.map(p =>
                p.originalIndex === originalIndex && p.duplicateIndex === duplicateIndex
                  ? { ...p, duplicateType }
                  : p
              ),
            };
          }

          // Add new pair
          const newPair: DuplicatePair = {
            originalIndex,
            duplicateIndex,
            originalId: `Sample_${originalIndex}`,
            duplicateId: `Sample_${duplicateIndex}`,
            duplicateType,
          };

          return {
            duplicatePairs: [...state.duplicatePairs, newPair],
          };
        });
      },

      // Analysis
      runAnalysis: (data, elements) => {
        const state = get();

        if (!state.sampleIdColumn || state.qcSamples.length === 0) {
          console.warn('Cannot run analysis: no samples detected');
          return;
        }

        set({ isAnalysisRunning: true });

        try {
          // Separate samples by type
          const standards = state.qcSamples.filter(s => s.qcType === 'standard');
          const blanks = state.qcSamples.filter(s => s.qcType === 'blank');

          // Get unique standard names
          const standardNames = [...new Set(standards.map(s => s.standardName).filter(Boolean))] as string[];

          // Build control charts for each standard and element
          const controlCharts: Record<string, ControlChartData[]> = {};

          standardNames.forEach((stdName) => {
            // Fix 1.6: Case-insensitive matching for standard reference lookup
            const reference = state.standardReferences.find(
              r => r.name.toUpperCase() === stdName.toUpperCase() || r.id.toUpperCase() === stdName.toUpperCase()
            );
            const charts: ControlChartData[] = [];

            elements.forEach((element) => {
              const chart = buildControlChart(
                data,
                standards,
                element,
                stdName,
                reference,
                state.thresholds
              );
              if (chart) {
                charts.push(chart);
              }
            });

            if (charts.length > 0) {
              controlCharts[stdName] = charts;
            }
          });

          // Analyze duplicates by type
          const duplicateAnalyses: Record<string, DuplicateAnalysis[]> = {};

          (['field_duplicate', 'pulp_duplicate', 'core_duplicate'] as const).forEach((dupType) => {
            const pairs = state.duplicatePairs.filter(p => p.duplicateType === dupType);
            if (pairs.length === 0) return;

            const analyses: DuplicateAnalysis[] = [];
            elements.forEach((element) => {
              const dl = state.detectionLimits[element];
              const analysis = analyzeDuplicates(data, pairs, element, dupType, state.thresholds, dl);
              if (analysis) {
                analyses.push(analysis);
              }
            });

            if (analyses.length > 0) {
              duplicateAnalyses[dupType] = analyses;
            }
          });

          // Analyze blanks
          const blankAnalyses: BlankAnalysis[] = [];
          elements.forEach((element) => {
            const dl = state.detectionLimits[element];
            const analysis = analyzeBlanks(data, blanks, element, dl, state.thresholds);
            if (analysis) {
              blankAnalyses.push(analysis);
            }
          });

          // Calculate element summaries
          const elementSummaries: ElementQCSummary[] = elements.map((element) => {
            // Standards summary
            let standardsAnalyzed = 0;
            let standardsPass = 0;
            Object.values(controlCharts).forEach((charts) => {
              const chart = charts.find(c => c.element === element);
              if (chart) {
                standardsAnalyzed += chart.points.length;
                standardsPass += chart.passCount + chart.warningCount; // Warnings still pass
              }
            });

            // Blanks summary
            const blankAnalysis = blankAnalyses.find(b => b.element === element);
            const blanksAnalyzed = blankAnalysis?.results.length || 0;
            const blanksClean = blankAnalysis?.cleanCount || 0;

            // Duplicates summary
            let duplicatesAnalyzed = 0;
            let duplicatesPass = 0;
            Object.values(duplicateAnalyses).forEach((analyses) => {
              const analysis = analyses.find(a => a.element === element);
              if (analysis) {
                duplicatesAnalyzed += analysis.results.length;
                duplicatesPass += analysis.passCount;
              }
            });

            // Fix 1.5: Don't default to 100% for types with no data
            const hasStandards = standardsAnalyzed > 0;
            const hasBlanks = blanksAnalyzed > 0;
            const hasDuplicates = duplicatesAnalyzed > 0;
            const standardsPassRate = hasStandards ? (standardsPass / standardsAnalyzed) * 100 : 0;
            const blanksPassRate = hasBlanks ? (blanksClean / blanksAnalyzed) * 100 : 0;
            const duplicatesPassRate = hasDuplicates ? (duplicatesPass / duplicatesAnalyzed) * 100 : 0;

            return {
              element,
              standardsAnalyzed,
              standardsPass,
              standardsPassRate,
              blanksAnalyzed,
              blanksClean,
              blanksPassRate,
              duplicatesAnalyzed,
              duplicatesPass,
              duplicatesPassRate,
              overallScore: calculateOverallScore(standardsPassRate, blanksPassRate, duplicatesPassRate, hasStandards, hasBlanks, hasDuplicates),
              grade: calculateElementGrade(standardsPassRate, blanksPassRate, duplicatesPassRate, hasStandards, hasBlanks, hasDuplicates),
              hasStandards,
              hasBlanks,
              hasDuplicates,
            };
          });

          // Calculate overall grade
          const avgScore = elementSummaries.length > 0
            ? elementSummaries.reduce((sum, e) => sum + e.overallScore, 0) / elementSummaries.length
            : 0;

          let overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
          if (avgScore >= 95) overallGrade = 'A';
          else if (avgScore >= 85) overallGrade = 'B';
          else if (avgScore >= 75) overallGrade = 'C';
          else if (avgScore >= 60) overallGrade = 'D';
          else overallGrade = 'F';

          // Generate recommendations
          const recommendations = generateRecommendations(elementSummaries);

          set({
            controlCharts,
            duplicateAnalyses,
            blankAnalyses,
            elementSummaries,
            overallGrade,
            recommendations,
            selectedElements: elements,
            isAnalysisRunning: false,
            lastAnalysisTimestamp: Date.now(),
          });
        } catch (error) {
          console.error('Error running QA/QC analysis:', error);
          set({ isAnalysisRunning: false });
        }
      },

      clearAnalysis: () => {
        set({
          controlCharts: {},
          duplicateAnalyses: {},
          blankAnalyses: [],
          elementSummaries: [],
          overallGrade: null,
          recommendations: [],
          lastAnalysisTimestamp: null,
        });
      },

      generateReport: (datasetName) => {
        const state = get();

        if (state.elementSummaries.length === 0 || !state.overallGrade) {
          return null;
        }

        // Fix 1.9: Calculate batch summaries with actual pass rate
        const batchIds = [...new Set(state.batches.values())];
        const batchSummaries = batchIds.map((batchId) => {
          const batchSamples = state.qcSamples.filter(s => s.batchId === batchId);
          const batchStandards = batchSamples.filter(s => s.qcType === 'standard');
          const batchBlanks = batchSamples.filter(s => s.qcType === 'blank');
          const batchDuplicateSamples = batchSamples.filter(s =>
            s.qcType === 'field_duplicate' ||
            s.qcType === 'pulp_duplicate' ||
            s.qcType === 'core_duplicate'
          );

          const sampleCount = [...state.batches.entries()].filter(([, b]) => b === batchId).length;
          const issues: string[] = [];

          // Calculate per-batch pass rate from control chart, duplicate, and blank results
          let totalChecks = 0;
          let totalPasses = 0;

          // Standards in this batch: check control chart points
          const batchStandardIndices = new Set(batchStandards.map(s => s.rowIndex));
          Object.values(state.controlCharts).forEach((charts) => {
            charts.forEach((chart) => {
              chart.points.forEach((point) => {
                if (batchStandardIndices.has(point.rowIndex)) {
                  totalChecks++;
                  if (point.status !== 'fail') totalPasses++;
                }
              });
            });
          });

          // Blanks in this batch
          const batchBlankIndices = new Set(batchBlanks.map(s => s.rowIndex));
          state.blankAnalyses.forEach((analysis) => {
            analysis.results.forEach((result) => {
              if (batchBlankIndices.has(result.rowIndex)) {
                totalChecks++;
                if (result.status === 'clean') totalPasses++;
              }
            });
          });

          // Duplicates in this batch
          const batchDupIndices = new Set(batchDuplicateSamples.map(s => s.rowIndex));
          Object.values(state.duplicateAnalyses).forEach((analyses) => {
            analyses.forEach((analysis) => {
              analysis.results.forEach((result) => {
                // Check if either the original or duplicate is in this batch
                const pair = state.duplicatePairs[result.pairIndex];
                if (pair && (batchDupIndices.has(pair.originalIndex) || batchDupIndices.has(pair.duplicateIndex))) {
                  totalChecks++;
                  if (result.status === 'pass') totalPasses++;
                }
              });
            });
          });

          const passRate = totalChecks > 0 ? (totalPasses / totalChecks) * 100 : 0;

          // Generate issues
          if (passRate < 80 && totalChecks > 0) {
            issues.push(`Low pass rate (${passRate.toFixed(0)}%)`);
          }
          const insertionRate = sampleCount > 0 ? ((batchStandards.length + batchBlanks.length + batchDuplicateSamples.length) / sampleCount) * 100 : 0;
          if (insertionRate < state.thresholds.minInsertionRate) {
            issues.push(`Low QC insertion rate (${insertionRate.toFixed(1)}%)`);
          }

          return {
            batchId,
            sampleCount,
            standardCount: batchStandards.length,
            blankCount: batchBlanks.length,
            duplicateCount: batchDuplicateSamples.length,
            insertionRate,
            passRate,
            issues,
          };
        });

        const totalSamples = state.batches.size;
        const qcSampleCount = state.qcSamples.length;

        return {
          generatedAt: new Date().toISOString(),
          datasetName,
          totalSamples,
          qcSamples: qcSampleCount,
          insertionRate: totalSamples > 0 ? (qcSampleCount / totalSamples) * 100 : 0,
          elementSummaries: state.elementSummaries,
          batchSummaries,
          overallGrade: state.overallGrade,
          recommendations: state.recommendations,
        };
      },

      reset: () => {
        set(initialState);
      },
    }),
    {
      name: 'qaqc-storage',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        sampleIdColumn: state.sampleIdColumn,
        batchColumn: state.batchColumn,
        duplicatePairColumn: state.duplicatePairColumn,
        thresholds: state.thresholds,
        standardReferences: state.standardReferences,
        detectionLimits: state.detectionLimits,
        selectedElements: state.selectedElements,
      }),
    }
  )
);
