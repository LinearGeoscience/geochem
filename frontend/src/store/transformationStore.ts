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
  assessAllElementQuality,
  filterQualityElements,
} from '../utils/calculations/pcaAnalysis';
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
} from '../utils/logratioTransforms';

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface TransformationState {
  // Current transformation settings
  activeTransformation: TransformationType;
  selectedColumns: string[];
  zeroStrategy: ZeroHandlingStrategy;
  customZeroValue: number;

  // ALR settings
  alrReference: string;

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
  pcaSelectedElements: string[];
  elementQualityInfo: ElementQualityInfo[];

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
  setNumeratorAmalgamation: (elements: string[]) => void;
  setDenominatorAmalgamation: (elements: string[]) => void;
  setChiPowerLambda: (lambda: number) => void;

  // Transformation execution
  executeTransformation: (data: Record<string, any>[], columns: string[]) => Promise<TransformationResult | null>;
  executePLR: (data: Record<string, any>[], columns: string[]) => TransformationResult;
  executeALR: (data: Record<string, any>[], columns: string[], reference: string) => TransformationResult;
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
  runFullPCA: (data: Record<string, any>[], columns: string[], nComponents?: number) => void;
  clearFullPcaResult: () => void;

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
      pcaSelectedElements: [],
      elementQualityInfo: [],

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
      setALRReference: (reference) => set({ alrReference: reference }),
      setNumeratorAmalgamation: (elements) => set({ numeratorAmalgamation: elements }),
      setDenominatorAmalgamation: (elements) => set({ denominatorAmalgamation: elements }),
      setChiPowerLambda: (lambda) => set({ chiPowerLambda: lambda }),

      // Main transformation execution
      executeTransformation: async (data, columns) => {
        const state = get();
        set({ isProcessing: true, error: null });

        try {
          let result: TransformationResult;

          switch (state.activeTransformation) {
            case 'plr':
              result = get().executePLR(data, columns);
              break;
            case 'alr':
              result = get().executeALR(data, columns, state.alrReference || columns[0]);
              break;
            case 'clr':
              result = get().executeCLR(data, columns);
              break;
            case 'ilr':
              result = get().executeILR(data, columns);
              break;
            case 'slr':
              result = get().executeSLR(data, state.numeratorAmalgamation, state.denominatorAmalgamation);
              break;
            case 'chipower':
              result = get().executeChiPower(data, columns, state.chiPowerLambda);
              break;
            default:
              throw new Error(`Unknown transformation type: ${state.activeTransformation}`);
          }

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
        const result = plrTransform(data, columns, {
          zeroStrategy: state.zeroStrategy,
          customZeroValue: state.customZeroValue
        });

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
        const result = alrTransform(data, columns, reference, {
          zeroStrategy: state.zeroStrategy,
          customZeroValue: state.customZeroValue
        });

        return {
          id: `alr_${Date.now()}`,
          config: {
            type: 'alr' as TransformationType,
            columns,
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue,
            alrReference: reference
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
        const result = clrTransform(data, columns, {
          zeroStrategy: state.zeroStrategy,
          customZeroValue: state.customZeroValue
        });

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
        const result = ilrTransform(data, columns, {
          zeroStrategy: state.zeroStrategy,
          customZeroValue: state.customZeroValue
        });

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
        const result = slrTransform(data, numerator, denominator, {
          zeroStrategy: state.zeroStrategy,
          customZeroValue: state.customZeroValue
        });

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
        const result = chiPowerTransform(data, columns, lambda);

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
          const decomposition = varianceDecomposition(data, columns, groups, {
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue
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
          const result = findOptimalALRReference(data, columns, {
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue
          });

          set({
            procrustesResult: {
              referenceElement: result.reference,
              correlation: result.correlation,
              rankings: result.rankings
            },
            alrReference: result.reference,
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
          const result = logratioAnalysis(data, columns, {
            zeroStrategy: state.zeroStrategy,
            customZeroValue: state.customZeroValue
          }, nComponents);

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
              columns: result.columns
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
          const classifications = classifyZeros(data, columns, detectionLimits);

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

      runFullPCA: (data, columns, nComponents = 8) => {
        const state = get();
        set({ isProcessing: true, error: null });

        try {
          const result = fullPCA(data, columns, nComponents, state.zeroStrategy as any);

          set({
            fullPcaResult: result,
            isProcessing: false
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Full PCA failed',
            isProcessing: false
          });
        }
      },

      clearFullPcaResult: () => set({
        fullPcaResult: null,
        elementQualityInfo: [],
        pcaSelectedElements: []
      }),

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
        elementQualityInfo: [],
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
        chiPowerLambda: state.chiPowerLambda
      })
    }
  )
);

export default useTransformationStore;
