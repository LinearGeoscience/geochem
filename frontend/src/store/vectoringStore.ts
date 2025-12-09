/**
 * Zustand store for managing deposit-specific vectoring analysis
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  DepositType,
  VectoringResult,
} from '../types/vectoring';
import {
  calculateVectoring,
  getDepositConfig,
  VECTORING_INDICATORS,
  DEPOSIT_CONFIGS,
} from '../utils/depositVectoring';

// ============================================================================
// STORE INTERFACE
// ============================================================================

interface VectoringState {
  // Current analysis settings
  selectedDepositType: DepositType | null;
  selectedIndicators: string[];

  // Results
  currentResult: VectoringResult | null;
  analysisHistory: VectoringResult[];

  // Comparison mode
  comparisonResults: VectoringResult[];
  isComparisonMode: boolean;

  // UI state
  isProcessing: boolean;
  error: string | null;
  activeTab: 'analysis' | 'results' | 'compare' | 'map';
  showAdvancedOptions: boolean;

  // Actions
  setSelectedDepositType: (type: DepositType | null) => void;
  setSelectedIndicators: (indicators: string[]) => void;
  setActiveTab: (tab: 'analysis' | 'results' | 'compare' | 'map') => void;
  setShowAdvancedOptions: (show: boolean) => void;

  // Analysis execution
  runVectoring: (data: Record<string, any>[], columns: string[]) => Promise<VectoringResult | null>;
  runMultipleDepositTypes: (data: Record<string, any>[], columns: string[], types: DepositType[]) => Promise<void>;

  // Comparison
  addToComparison: (result: VectoringResult) => void;
  removeFromComparison: (depositType: DepositType) => void;
  clearComparison: () => void;
  toggleComparisonMode: () => void;

  // Utility
  clearResults: () => void;
  clearError: () => void;
  getAvailableIndicators: () => typeof VECTORING_INDICATORS;
  getDepositConfigs: () => typeof DEPOSIT_CONFIGS;
}

// ============================================================================
// STORE IMPLEMENTATION
// ============================================================================

export const useVectoringStore = create<VectoringState>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedDepositType: null,
      selectedIndicators: [],
      currentResult: null,
      analysisHistory: [],
      comparisonResults: [],
      isComparisonMode: false,
      isProcessing: false,
      error: null,
      activeTab: 'analysis',
      showAdvancedOptions: false,

      // Setters
      setSelectedDepositType: (type) => {
        set({ selectedDepositType: type });
        // Auto-select indicators for this deposit type
        if (type) {
          const config = getDepositConfig(type);
          if (config) {
            set({ selectedIndicators: config.indicators });
          }
        }
      },

      setSelectedIndicators: (indicators) => set({ selectedIndicators: indicators }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setShowAdvancedOptions: (show) => set({ showAdvancedOptions: show }),

      // Main vectoring analysis
      runVectoring: async (data, columns) => {
        const { selectedDepositType } = get();

        if (!selectedDepositType) {
          set({ error: 'Please select a deposit type' });
          return null;
        }

        if (data.length === 0) {
          set({ error: 'No data available for analysis' });
          return null;
        }

        set({ isProcessing: true, error: null });

        try {
          const result = calculateVectoring(data, columns, selectedDepositType);

          set(state => ({
            currentResult: result,
            analysisHistory: [...state.analysisHistory.slice(-9), result], // Keep last 10
            isProcessing: false,
            activeTab: 'results'
          }));

          return result;
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Vectoring analysis failed',
            isProcessing: false
          });
          return null;
        }
      },

      // Run analysis for multiple deposit types
      runMultipleDepositTypes: async (data, columns, types) => {
        set({ isProcessing: true, error: null, comparisonResults: [] });

        try {
          const results: VectoringResult[] = [];

          for (const depositType of types) {
            try {
              const result = calculateVectoring(data, columns, depositType);
              results.push(result);
            } catch (e) {
              console.warn(`Failed to calculate vectoring for ${depositType}:`, e);
            }
          }

          set({
            comparisonResults: results,
            isComparisonMode: true,
            isProcessing: false,
            activeTab: 'compare'
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Multi-deposit analysis failed',
            isProcessing: false
          });
        }
      },

      // Comparison management
      addToComparison: (result) => {
        set(state => {
          // Don't add duplicates
          if (state.comparisonResults.some(r => r.depositType === result.depositType)) {
            return state;
          }
          return {
            comparisonResults: [...state.comparisonResults, result]
          };
        });
      },

      removeFromComparison: (depositType) => {
        set(state => ({
          comparisonResults: state.comparisonResults.filter(r => r.depositType !== depositType)
        }));
      },

      clearComparison: () => set({ comparisonResults: [], isComparisonMode: false }),

      toggleComparisonMode: () => set(state => ({ isComparisonMode: !state.isComparisonMode })),

      // Utility
      clearResults: () => set({
        currentResult: null,
        error: null
      }),

      clearError: () => set({ error: null }),

      getAvailableIndicators: () => VECTORING_INDICATORS,

      getDepositConfigs: () => DEPOSIT_CONFIGS
    }),
    {
      name: 'vectoring-storage',
      partialize: (state) => ({
        selectedDepositType: state.selectedDepositType,
        analysisHistory: state.analysisHistory.slice(-5) // Only persist last 5
      })
    }
  )
);

export default useVectoringStore;
