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
  isAnalysisRunning: boolean;
  lastAnalysisTimestamp: number | null;

  // Actions
  setSampleIdColumn: (column: string | null) => void;
  setBatchColumn: (column: string | null) => void;
  setThresholds: (thresholds: Partial<QAQCThresholds>) => void;
  addStandardReference: (reference: StandardReference) => void;
  removeStandardReference: (id: string) => void;
  setDetectionLimit: (element: string, dl: number) => void;
  setSelectedElements: (elements: string[]) => void;
  setSelectedStandard: (standard: string | null) => void;

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

        // Detect duplicate pairs for each type
        const fieldDuplicates = detectDuplicatePairs(data, sampleIdCol, 'field_duplicate');
        const pulpDuplicates = detectDuplicatePairs(data, sampleIdCol, 'pulp_duplicate');
        const coreDuplicates = detectDuplicatePairs(data, sampleIdCol, 'core_duplicate');
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
            const reference = state.standardReferences.find(r => r.name === stdName || r.id === stdName);
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
              const analysis = analyzeDuplicates(data, pairs, element, dupType, state.thresholds);
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

            const standardsPassRate = standardsAnalyzed > 0 ? (standardsPass / standardsAnalyzed) * 100 : 100;
            const blanksPassRate = blanksAnalyzed > 0 ? (blanksClean / blanksAnalyzed) * 100 : 100;
            const duplicatesPassRate = duplicatesAnalyzed > 0 ? (duplicatesPass / duplicatesAnalyzed) * 100 : 100;

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
              overallScore: calculateOverallScore(standardsPassRate, blanksPassRate, duplicatesPassRate),
              grade: calculateElementGrade(standardsPassRate, blanksPassRate, duplicatesPassRate),
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

        // Calculate batch summaries
        const batchIds = [...new Set(state.batches.values())];
        const batchSummaries = batchIds.map((batchId) => {
          const batchSamples = state.qcSamples.filter(s => s.batchId === batchId);
          const standards = batchSamples.filter(s => s.qcType === 'standard').length;
          const blanks = batchSamples.filter(s => s.qcType === 'blank').length;
          const duplicates = batchSamples.filter(s =>
            s.qcType === 'field_duplicate' ||
            s.qcType === 'pulp_duplicate' ||
            s.qcType === 'core_duplicate'
          ).length;

          const sampleCount = [...state.batches.entries()].filter(([, b]) => b === batchId).length;

          return {
            batchId,
            sampleCount,
            standardCount: standards,
            blankCount: blanks,
            duplicateCount: duplicates,
            insertionRate: sampleCount > 0 ? ((standards + blanks + duplicates) / sampleCount) * 100 : 0,
            passRate: 0, // Would need detailed per-batch analysis
            issues: [] as string[],
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
        thresholds: state.thresholds,
        standardReferences: state.standardReferences,
        detectionLimits: state.detectionLimits,
        selectedElements: state.selectedElements,
      }),
    }
  )
);
