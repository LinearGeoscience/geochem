/**
 * Zustand store for managing compositional data transformations
 * Based on GeoCoDA workflow
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  TransformationType,
  ZeroHandlingStrategy,
  TransformationResult,
  AmalgamationDefinition,
  VarianceDecompositionResult,
  ProcrustesResult,
  ZeroSummary,
  PCAResult,
  FullPCAResult,
  ElementQualityInfo,
  LogAdditiveIndexResult,
} from '../types/compositional';
import { CustomAssociation } from '../types/associations';
import {
  createLogAdditiveIndex,
  suggestIndexName,
} from '../utils/calculations/logAdditiveIndex';
import {
  fullPCA,
  PCATransform,
  assessAllElementQuality,
  filterQualityElements,
} from '../utils/calculations/pcaAnalysis';
import { analysisInWorker } from '../utils/analysisWorker';
import { detectElementFromColumnName } from '../utils/calculations/elementNameNormalizer';
import {
  plrTransform,
  alrTransform,
  clrTransform,
  ilrTransform,
  slrTransform,
  chiPowerTransform,
  varianceDecomposition,
  getTopPLRs,
  findOptimalALRReference,
  logratioAnalysis,
  classifyZeros,
  PREDEFINED_AMALGAMATIONS,
  findAmalgamationColumns,
  plrTransformColumnar,
  alrTransformColumnar,
  clrTransformColumnar,
  ilrTransformColumnar,
  slrTransformColumnar,
  chiPowerTransformColumnar,
  varianceDecompositionColumnar,
  findOptimalALRReferenceColumnar,
  logratioAnalysisColumnar,
  classifyZerosColumnar,
  ColumnGetter,
} from '../utils/logratioTransforms';
import { useAppStore } from './appStore';

// ============================================================================
// STORE INTERFACE
// ============================================================================

/** PCA workflow screen state, kept here so leaving Analysis does not reset it. */
export interface PcaUiState {
  step: number;
  resultsTab: number;
  nComponents: number;
  transform: PCATransform;
  useFilteredData: boolean;
  /** Step 1: list elements by fewest samples dropped (instead of column order) */
  sortByFewestDropped: boolean;
}

const DEFAULT_PCA_UI: PcaUiState = { step: 0, resultsTab: 0, nComponents: 8, transform: 'clr', useFilteredData: false, sortByFewestDropped: false };

interface TransformationState {
  // Current transformation settings
  activeTransformation: TransformationType;
  selectedColumns: string[];
  zeroStrategy: ZeroHandlingStrategy;
  customZeroValue: number;

  // ALR settings
  alrReference: string;
  /** ALR denominator: one element, or the geometric mean of several (alrReference = the first) */
  alrReferences: string[];
  alrLogBase: 'e' | '10';

  // SLR/Amalgamation settings
  numeratorAmalgamation: string[];
  denominatorAmalgamation: string[];

  // chiPower settings
  chiPowerLambda: number;

  // Results
  transformationHistory: TransformationResult[];
  currentResult: TransformationResult | null;
  varianceResult: VarianceDecompositionResult | null;
  procrustesResult: ProcrustesResult | null;
  pcaResult: PCAResult | null;
  zeroSummary: ZeroSummary | null;

  // Full PCA workflow state
  fullPcaResult: FullPCAResult | null;
  /** Dataset row index of each row passed to the PCA (maps scores back to the data). */
  pcaInputIndices: number[] | null;
  /** Which rows the last PCA used: only the visible rows, or all rows */
  pcaRowBasis: 'visible' | 'all' | null;
  /** Prefix of the score columns added for the current PCA ('' = PC1, negPC1, ...) */
  pcScorePrefix: string;
  setPcScorePrefix: (prefix: string) => void;
  pcaSelectedElements: string[];
  elementQualityInfo: ElementQualityInfo[];
  pcaUi: PcaUiState;

  // Log Additive Index state
  logAdditiveIndices: LogAdditiveIndexResult[];
  logAdditiveSelectedColumns: string[];
  logAdditiveIndexName: string;

  // Amalgamation library
  customAmalgamations: AmalgamationDefinition[];

  // Custom associations (user-defined element groupings)
  customAssociations: CustomAssociation[];

  // UI state
  isProcessing: boolean;
  error: string | null;

  // Actions
  setActiveTransformation: (type: TransformationType) => void;
  setSelectedColumns: (columns: string[]) => void;
  setZeroStrategy: (strategy: ZeroHandlingStrategy) => void;
  setCustomZeroValue: (value: number) => void;
  setALRReference: (reference: string) => void;
  setALRReferences: (references: string[]) => void;
  setALRLogBase: (base: 'e' | '10') => void;
  setNumeratorAmalgamation: (elements: string[]) => void;
  setDenominatorAmalgamation: (elements: string[]) => void;
  setChiPowerLambda: (lambda: number) => void;

  // Transformation execution
  executeTransformation: (data: Record<string, any>[], columns: string[]) => Promise<TransformationResult | null>;
  executePLR: (data: Record<string, any>[], columns: string[]) => TransformationResult;
  executeALR: (data: Record<string, any>[], columns: string[], reference: string | string[]) => TransformationResult;
  executeCLR: (data: Record<string, any>[], columns: string[]) => TransformationResult;
  executeILR: (data: Record<string, any>[], columns: string[]) => TransformationResult;
  executeSLR: (data: Record<string, any>[], numerator: string[], denominator: string[]) => TransformationResult;
  executeChiPower: (data: Record<string, any>[], columns: string[], lambda: number) => TransformationResult;

  // Analysis
  runVarianceDecomposition: (data: Record<string, any>[], columns: string[], groups?: string[]) => void;
  runProcrustesAnalysis: (data: Record<string, any>[], columns: string[]) => void;
  runPCA: (data: Record<string, any>[], columns: string[], nComponents?: number) => void;
  analyzeZeros: (data: Record<string, any>[], columns: string[], detectionLimits?: Record<string, number>) => void;

  // Full PCA workflow
  setPcaSelectedElements: (elements: string[]) => void;
  runElementQualityAssessment: (data: Record<string, any>[], columns: string[], detectionLimits?: Record<string, number>) => void;
  runFullPCA: (data: Record<string, any>[], columns: string[], nComponents?: number, displayNames?: string[], transform?: PCATransform, inputIndices?: number[], rowBasis?: 'visible' | 'all') => Promise<void>;
  clearFullPcaResult: () => void;
  setPcaUi: (patch: Partial<PcaUiState>) => void;

  // Log Additive Index
  setLogAdditiveSelectedColumns: (columns: string[]) => void;
  setLogAdditiveIndexName: (name: string) => void;
  createLogAdditiveIndex: (data: Record<string, any>[], columns: string[], name: string) => LogAdditiveIndexResult | null;
  suggestLogAdditiveIndexName: (columns: string[]) => string;
  clearLogAdditiveIndices: () => void;

  // Amalgamation management
  addCustomAmalgamation: (amalgamation: AmalgamationDefinition) => void;
  removeCustomAmalgamation: (id: string) => void;
  getAllAmalgamations: () => AmalgamationDefinition[];
  findMatchingColumns: (amalgamationId: string, availableColumns: string[]) => string[];

  // Custom association management
  addCustomAssociation: (association: Omit<CustomAssociation, 'id' | 'createdAt'>) => CustomAssociation;
  removeCustomAssociation: (id: string) => void;
  getCustomAssociations: () => CustomAssociation[];

  // Utility
  clearResults: () => void;
  clearError: () => void;
}

// ============================================================================
// COLUMNAR ACCESS HELPER
// ============================================================================

/** Get columnar accessor from appStore if available. Returns null if no columnar data. */
/**
 * Rows the current run is restricted to (complete cases), set only for the
 * duration of a synchronous run by withCompleteRows().
 */
let rowSubset: number[] | null = null;

function fullColumnarAccess(): { getCol: ColumnGetter; rowCount: number } | null {
  // Analytical values: below-detection values substituted (utils/censoring)
  const columnarData = useAppStore.getState().getAnalyticalStore();
  if (columnarData.rowCount === 0) return null;
  return {
    getCol: (name: string) => {
      const col = columnarData.columns.get(name);
      return col instanceof Float64Array ? col : undefined;
    },
    rowCount: columnarData.rowCount,
  };
}

function getColumnarAccess(): { getCol: ColumnGetter; rowCount: number } | null {
  const full = fullColumnarAccess();
  if (!full || !rowSubset) return full;
  const rows = rowSubset;
  const cache = new Map<string, Float64Array | undefined>();
  return {
    getCol: (name: string) => {
      if (!cache.has(name)) {
        const col = full.getCol(name);
        cache.set(name, col ? Float64Array.from(rows, i => col[i]) : undefined);
      }
      return cache.get(name);
    },
    rowCount: rows.length,
  };
}

/** Rows with a finite value in every one of `columns` (analytical values). */
export function completeRowIndices(data: Record<string, any>[], columns: string[]): { kept: number[]; total: number } {
  const ca = fullColumnarAccess();
  const kept: number[] = [];
  if (ca) {
    const cols = columns.map(c => ca.getCol(c));
    if (cols.some(c => !c)) return { kept, total: ca.rowCount };
    for (let i = 0; i < ca.rowCount; i++) {
      let ok = true;
      for (const c of cols) if (!Number.isFinite(c![i])) { ok = false; break; }
      if (ok) kept.push(i);
    }
    return { kept, total: ca.rowCount };
  }
  data.forEach((row, i) => {
    if (columns.every(c => typeof row[c] === 'number' && Number.isFinite(row[c]))) kept.push(i);
  });
  return { kept, total: data.length };
}

/**
 * Run `fn` on the complete cases only. Logratio maths needs a value for
 * every part: the transforms used to turn a MISSING value into 0 and then
 * "replace the zero" with half the minimum, so a row assayed only for
 * Au/Cu/Pb/Zn got ~70 invented values. Zero handling now applies to real
 * zeros in complete rows only.
 */
function withCompleteRows<T>(data: Record<string, any>[], columns: string[], fn: (rows: Record<string, any>[]) => T) {
  const { kept, total } = completeRowIndices(data, columns);
  if (kept.length < 2) {
    throw new Error(`Only ${kept.length} of ${total.toLocaleString()} rows have a value for every selected column. Deselect the elements with low coverage.`);
  }
  rowSubset = kept.length === total ? null : kept;
  try {
    const rows = rowSubset && data.length === total ? kept.map(i => data[i]) : data;
    return { result: fn(rows), kept, total };
  } finally {
    rowSubset = null;
  }
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useTransformationStore = create<TransformationState>()(
  persist(
    (set, get) => ({
      // Initial state
      activeTransformation: 'clr',
      selectedColumns: [],
      zeroStrategy: 'half-min',
      customZeroValue: 0.001,
      alrReference: '',
      alrReferences: [],
      alrLogBase: 'e',
      numeratorAmalgamation: [],
      denominatorAmalgamation: [],
      chiPowerLambda: 0.25,

      transformationHistory: [],
      currentResult: null,
      varianceResult: null,
      procrustesResult: null,
      pcaResult: null,
      zeroSummary: null,

      // Full PCA workflow
      fullPcaResult: null,
      pcaInputIndices: null,
      pcaRowBasis: null,
      pcScorePrefix: '',
      setPcScorePrefix: (prefix) => set({ pcScorePrefix: prefix }),
      pcaSelectedElements: [],
      elementQualityInfo: [],
      pcaUi: DEFAULT_PCA_UI,

      // Log Additive Index
      logAdditiveIndices: [],
      logAdditiveSelectedColumns: [],
      logAdditiveIndexName: '',

      customAmalgamations: [],
      customAssociations: [],

      isProcessing: false,
      error: null,

      // Setters
      setActiveTransformation: (type) => set({ activeTransformation: type }),
      setSelectedColumns: (columns) => set({ selectedColumns: columns }),
      setZeroStrategy: (strategy) => set({ zeroStrategy: strategy }),
      setCustomZeroValue: (value) => set({ customZeroValue: value }),
      setALRReference: (reference) => set({ alrReference: reference, alrReferences: reference ? [reference] : [] }),
      setALRReferences: (references) => set({ alrReferences: [...new Set(references)], alrReference: references[0] ?? '' }),
      setALRLogBase: (base) => set({ alrLogBase: base }),
      setNumeratorAmalgamation: (elements) => set({ numeratorAmalgamation: elements }),
      setDenominatorAmalgamation: (elements) => set({ denominatorAmalgamation: elements }),
      setChiPowerLambda: (lambda) => set({ chiPowerLambda: lambda }),

      // Main transformation execution
      executeTransformation: async (data, columns) => {
        const state = get();
        set({ isProcessing: true, error: null });

        try {
          // ALR: the reference(s) are always inputs (they may be picked outside the selection)
          const alrRefs = state.alrReferences.length ? state.alrReferences : (state.alrReference ? [state.alrReference] : [columns[0]]);
          const alrColumns = [...columns, ...alrRefs.filter(r => !columns.includes(r))];
          const inputs = state.activeTransformation === 'slr'
            ? [...state.numeratorAmalgamation, ...state.denominatorAmalgamation]
            : state.activeTransformation === 'alr' ? alrColumns : columns;
          const run = withCompleteRows(data, inputs, (rows): TransformationResult => {
            switch (state.activeTransformation) {
              case 'plr': return get().executePLR(rows, columns);
              case 'alr': return get().executeALR(rows, alrColumns, alrRefs);
              case 'clr': return get().executeCLR(rows, columns);
              case 'ilr': return get().executeILR(rows, columns);
              case 'slr': return get().executeSLR(rows, state.numeratorAmalgamation, state.denominatorAmalgamation);
              case 'chipower': return get().executeChiPower(rows, columns, state.chiPowerLambda);
              default:
                throw new Error(`Unknown transformation type: ${state.activeTransformation}`);
            }
          });
          // Back to one row per dataset row; rows missing an input stay empty (NaN)
          const width = run.result.columnNames.length;
          const values: number[][] = new Array(run.total);
          const empty = new Array(width).fill(NaN);
          for (let i = 0; i < run.total; i++) values[i] = empty;
          run.kept.forEach((rowIdx, k) => { values[rowIdx] = run.result.values[k]; });
          const result: TransformationResult = {
            ...run.result,
            values,
            nRowsUsed: run.kept.length,
            nRowsDropped: run.total - run.kept.length,
          };

          set({
            currentResult: result,
            transformationHistory: [...state.transformationHistory, result],
            isProcessing: false
          });

          return result;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Transformation failed',
            isProcessing: false
          });
          return null;
        }
      },

      // Individual transformation methods
      executePLR: (data, columns) => {
        const state = get();
        const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue };
        const ca = getColumnarAccess();
        const result = ca
          ? plrTransformColumnar(ca.getCol, ca.rowCount, columns, opts)
          : plrTransform(data, columns, opts);

        return {
          id: `plr_${Date.now()}`,
          config: {
            type: 'plr' as TransformationType,
            columns,
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue
          },
          values: result.values,
          columnNames: result.names,
          zerosReplaced: 0,
          timestamp: new Date()
        };
      },

      executeALR: (data, columns, reference) => {
        const state = get();
        const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue, logBase: state.alrLogBase };
        const refs = Array.isArray(reference) ? reference : [reference];
        const ca = getColumnarAccess();
        const result = ca
          ? alrTransformColumnar(ca.getCol, ca.rowCount, columns, reference, opts)
          : alrTransform(data, columns, reference, opts);

        return {
          id: `alr_${Date.now()}`,
          config: {
            type: 'alr' as TransformationType,
            columns,
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue,
            alrReference: result.reference,
            alrReferences: refs,
            alrLogBase: state.alrLogBase,
          },
          values: result.values,
          columnNames: result.names,
          zerosReplaced: 0,
          timestamp: new Date(),
          procrustesCorrelation: result.procrustesCorrelation
        };
      },

      executeCLR: (data, columns) => {
        const state = get();
        const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue };
        const ca = getColumnarAccess();
        const result = ca
          ? clrTransformColumnar(ca.getCol, ca.rowCount, columns, opts)
          : clrTransform(data, columns, opts);

        return {
          id: `clr_${Date.now()}`,
          config: {
            type: 'clr' as TransformationType,
            columns,
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue
          },
          values: result.values,
          columnNames: result.columns,
          zerosReplaced: result.zerosReplaced,
          timestamp: new Date()
        };
      },

      executeILR: (data, columns) => {
        const state = get();
        const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue };
        const ca = getColumnarAccess();
        const result = ca
          ? ilrTransformColumnar(ca.getCol, ca.rowCount, columns, opts)
          : ilrTransform(data, columns, opts);

        return {
          id: `ilr_${Date.now()}`,
          config: {
            type: 'ilr' as TransformationType,
            columns,
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue
          },
          values: result.values,
          columnNames: result.names,
          zerosReplaced: 0,
          timestamp: new Date()
        };
      },

      executeSLR: (data, numerator, denominator) => {
        const state = get();
        const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue };
        const ca = getColumnarAccess();
        const result = ca
          ? slrTransformColumnar(ca.getCol, ca.rowCount, numerator, denominator, opts)
          : slrTransform(data, numerator, denominator, opts);

        return {
          id: `slr_${Date.now()}`,
          config: {
            type: 'slr' as TransformationType,
            columns: [...numerator, ...denominator],
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue,
            slrNumeratorGroup: numerator,
            slrDenominatorGroup: denominator
          },
          values: result.values.map(v => [v]),
          columnNames: [result.name],
          zerosReplaced: 0,
          timestamp: new Date()
        };
      },

      executeChiPower: (data, columns, lambda) => {
        const ca = getColumnarAccess();
        const result = ca
          ? chiPowerTransformColumnar(ca.getCol, ca.rowCount, columns, lambda)
          : chiPowerTransform(data, columns, lambda);

        return {
          id: `chipower_${Date.now()}`,
          config: {
            type: 'chipower' as TransformationType,
            columns,
            zeroStrategy: 'half-min' as ZeroHandlingStrategy,
            chiPowerLambda: lambda
          },
          values: result.values,
          columnNames: result.columns,
          zerosReplaced: 0,
          timestamp: new Date()
        };
      },

      // Analysis methods
      runVarianceDecomposition: (data, columns, groups) => {
        const state = get();
        set({ isProcessing: true, error: null });

        try {
          const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue };
          const { result: decomposition } = withCompleteRows(data, columns, (rows) => {
            const ca = getColumnarAccess();
            // groups is one label per dataset row: keep it aligned with the subset
            const g = groups && rowSubset ? rowSubset.map(i => groups[i]) : groups;
            return ca
              ? varianceDecompositionColumnar(ca.getCol, ca.rowCount, columns, g, opts)
              : varianceDecomposition(rows, columns, g, opts);
          });

          const topByContributed = getTopPLRs(decomposition, 'contributed', 10);
          const topByExplained = getTopPLRs(decomposition, 'explained', 10);
          const topByBetweenGroup = groups ? getTopPLRs(decomposition, 'between-group', 10) : undefined;

          // Calculate total logratio variance
          const totalVariance = decomposition.reduce((sum, d) => sum + d.contributedVariance, 0);

          const result: VarianceDecompositionResult = {
            totalLogratioVariance: totalVariance,
            plrVariances: decomposition.map(d => ({
              plrName: d.plr,
              numerator: d.plr.split('/')[0],
              denominator: d.plr.split('/')[1],
              contributedVariance: d.contributedVariance,
              explainedVariance: d.explainedVariance,
              betweenGroupVariance: d.betweenGroupVariance
            })),
            topByContributed: topByContributed.map(d => ({
              plrName: d.plr,
              numerator: d.plr.split('/')[0],
              denominator: d.plr.split('/')[1],
              contributedVariance: d.contributedVariance,
              explainedVariance: d.explainedVariance,
              betweenGroupVariance: d.betweenGroupVariance
            })),
            topByExplained: topByExplained.map(d => ({
              plrName: d.plr,
              numerator: d.plr.split('/')[0],
              denominator: d.plr.split('/')[1],
              contributedVariance: d.contributedVariance,
              explainedVariance: d.explainedVariance,
              betweenGroupVariance: d.betweenGroupVariance
            })),
            topByBetweenGroup: topByBetweenGroup?.map(d => ({
              plrName: d.plr,
              numerator: d.plr.split('/')[0],
              denominator: d.plr.split('/')[1],
              contributedVariance: d.contributedVariance,
              explainedVariance: d.explainedVariance,
              betweenGroupVariance: d.betweenGroupVariance
            }))
          };

          set({ varianceResult: result, isProcessing: false });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Variance decomposition failed',
            isProcessing: false
          });
        }
      },

      runProcrustesAnalysis: (data, columns) => {
        const state = get();
        set({ isProcessing: true, error: null });

        try {
          const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue };
          const { result } = withCompleteRows(data, columns, (rows) => {
            const ca = getColumnarAccess();
            return ca
              ? findOptimalALRReferenceColumnar(ca.getCol, ca.rowCount, columns, opts)
              : findOptimalALRReference(rows, columns, opts);
          });

          set({
            procrustesResult: {
              referenceElement: result.reference,
              correlation: result.correlation,
              rankings: result.rankings
            },
            alrReference: result.reference,
            alrReferences: [result.reference],
            isProcessing: false
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Procrustes analysis failed',
            isProcessing: false
          });
        }
      },

      runPCA: (data, columns, nComponents = 2) => {
        const state = get();
        set({ isProcessing: true, error: null });

        try {
          const opts = { zeroStrategy: state.zeroStrategy, customZeroValue: state.customZeroValue };
          const { result } = withCompleteRows(data, columns, (rows) => {
            const ca = getColumnarAccess();
            return ca
              ? logratioAnalysisColumnar(ca.getCol, ca.rowCount, columns, opts, nComponents)
              : logratioAnalysis(rows, columns, opts, nComponents);
          });

          // Calculate cumulative variance
          const cumulativeVariance: number[] = [];
          let cumSum = 0;
          for (const v of result.variance) {
            cumSum += v;
            cumulativeVariance.push(cumSum);
          }

          set({
            pcaResult: {
              scores: result.scores,
              loadings: result.loadings,
              eigenvalues: result.variance.map(v => v * result.totalVariance),
              varianceExplained: result.variance.map(v => v * 100),
              cumulativeVariance: cumulativeVariance.map(v => v * 100),
              columns: result.columns,
              displayColumns: result.columns.map(c => detectElementFromColumnName(c) ?? c)
            },
            isProcessing: false
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'PCA failed',
            isProcessing: false
          });
        }
      },

      analyzeZeros: (data, columns, detectionLimits) => {
        set({ isProcessing: true, error: null });

        try {
          const ca = getColumnarAccess();
          const classifications = ca
            ? classifyZerosColumnar(ca.getCol, ca.rowCount, columns, detectionLimits)
            : classifyZeros(data, columns, detectionLimits);

          // Summarize by type
          const byType: Record<string, number> = {
            structural: 0,
            missing: 0,
            'below-dl': 0,
            unknown: 0
          };
          const byColumn: Record<string, number> = {};

          for (const c of classifications) {
            byType[c.type]++;
            byColumn[c.column] = (byColumn[c.column] || 0) + 1;
          }

          set({
            zeroSummary: {
              totalZeros: classifications.length,
              byType: byType as Record<any, number>,
              byColumn,
              classifications: classifications.map(c => ({
                rowIndex: c.index,
                column: c.column,
                type: c.type,
                detectionLimit: c.detectionLimit
              }))
            },
            isProcessing: false
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Zero analysis failed',
            isProcessing: false
          });
        }
      },

      // Full PCA workflow methods
      setPcaSelectedElements: (elements) => set({ pcaSelectedElements: elements }),

      runElementQualityAssessment: (data, columns, detectionLimits) => {
        set({ isProcessing: true, error: null });

        try {
          const qualityInfo = assessAllElementQuality(data, columns, detectionLimits);
          const acceptableElements = filterQualityElements(columns, qualityInfo);

          set({
            elementQualityInfo: qualityInfo,
            pcaSelectedElements: acceptableElements,
            isProcessing: false
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Element quality assessment failed',
            isProcessing: false
          });
        }
      },

      runFullPCA: async (data, columns, nComponents = 8, displayNames, transform = 'clr', inputIndices, rowBasis) => {
        const state = get();
        // Never "run" on nothing: an empty subset (e.g. every class hidden) must say so
        if (data.length < 2) {
          set({ error: `PCA needs at least 2 samples; ${data.length} ${rowBasis === 'visible' ? 'visible ' : ''}row${data.length === 1 ? '' : 's'} given.`, fullPcaResult: null, pcaInputIndices: null, pcaRowBasis: null });
          return;
        }
        set({ isProcessing: true, error: null });

        try {
          // Off the main thread — full PCA on large datasets froze the UI
          const result = await analysisInWorker<ReturnType<typeof fullPCA>>('fullPCA', {
            data, columns, nComponents,
            zeroStrategy: state.zeroStrategy, displayNames, transform,
            ...(transform === 'alr' ? { references: state.alrReferences } : {}),
          });

          if (!(result.nSamples >= 2)) {
            set({ error: `PCA needs at least 2 complete samples; ${result.nSamples} had values for every selected element.`, fullPcaResult: null, pcaInputIndices: null, pcaRowBasis: null, isProcessing: false });
            return;
          }
          set({
            fullPcaResult: result,
            pcaInputIndices: inputIndices ?? data.map((_, i) => i),
            pcaRowBasis: rowBasis ?? null,
            pcScorePrefix: '',
            isProcessing: false
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Full PCA failed',
            isProcessing: false
          });
        }
      },

      clearFullPcaResult: () => set(s => ({
        fullPcaResult: null,
        pcaInputIndices: null,
        pcaRowBasis: null,
        elementQualityInfo: [],
        pcaSelectedElements: [],
        pcaUi: { ...s.pcaUi, step: 0, resultsTab: 0 },
      })),

      setPcaUi: (patch) => set(s => ({ pcaUi: { ...s.pcaUi, ...patch } })),

      // Log Additive Index methods
      setLogAdditiveSelectedColumns: (columns) => set({ logAdditiveSelectedColumns: columns }),

      setLogAdditiveIndexName: (name) => set({ logAdditiveIndexName: name }),

      suggestLogAdditiveIndexName: (columns) => suggestIndexName(columns),

      createLogAdditiveIndex: (data, columns, name) => {
        const state = get();
        set({ isProcessing: true, error: null });

        try {
          const result = createLogAdditiveIndex(data, {
            name,
            columns,
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue
          });

          if (result) {
            set({
              logAdditiveIndices: [...state.logAdditiveIndices, result],
              isProcessing: false
            });
            return result;
          } else {
            set({
              error: 'Failed to create log additive index',
              isProcessing: false
            });
            return null;
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Log additive index creation failed',
            isProcessing: false
          });
          return null;
        }
      },

      clearLogAdditiveIndices: () => set({
        logAdditiveIndices: [],
        logAdditiveSelectedColumns: [],
        logAdditiveIndexName: ''
      }),

      // Amalgamation management
      addCustomAmalgamation: (amalgamation) => {
        set(state => ({
          customAmalgamations: [...state.customAmalgamations, amalgamation]
        }));
      },

      removeCustomAmalgamation: (id) => {
        set(state => ({
          customAmalgamations: state.customAmalgamations.filter(a => a.id !== id)
        }));
      },

      getAllAmalgamations: () => {
        const state = get();
        const builtIn = PREDEFINED_AMALGAMATIONS.map(a => ({
          ...a,
          isBuiltIn: true,
          category: a.category as any
        }));
        return [...builtIn, ...state.customAmalgamations];
      },

      findMatchingColumns: (amalgamationId, availableColumns) => {
        const allAmalgamations = get().getAllAmalgamations();
        const amalgamation = allAmalgamations.find(a => a.id === amalgamationId);

        if (!amalgamation) return [];

        return findAmalgamationColumns(availableColumns, amalgamation as any);
      },

      // Custom association management
      addCustomAssociation: (associationData) => {
        const newAssociation: CustomAssociation = {
          ...associationData,
          id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          createdAt: new Date(),
        };

        set(state => ({
          customAssociations: [...state.customAssociations, newAssociation]
        }));

        return newAssociation;
      },

      removeCustomAssociation: (id) => {
        set(state => ({
          customAssociations: state.customAssociations.filter(a => a.id !== id)
        }));
      },

      getCustomAssociations: () => {
        return get().customAssociations;
      },

      // Utility
      clearResults: () => set({
        currentResult: null,
        varianceResult: null,
        procrustesResult: null,
        pcaResult: null,
        zeroSummary: null,
        fullPcaResult: null,
        pcaInputIndices: null,
        pcaRowBasis: null,
        elementQualityInfo: [],
        pcaUi: DEFAULT_PCA_UI,
        logAdditiveIndices: [],
        logAdditiveSelectedColumns: [],
        logAdditiveIndexName: '',
        error: null
      }),

      clearError: () => set({ error: null })
    }),
    {
      name: 'transformation-storage',
      partialize: (state) => ({
        customAmalgamations: state.customAmalgamations,
        customAssociations: state.customAssociations,
        zeroStrategy: state.zeroStrategy,
        customZeroValue: state.customZeroValue,
        chiPowerLambda: state.chiPowerLambda,
        alrLogBase: state.alrLogBase,
      })
    }
  )
);

export default useTransformationStore;
