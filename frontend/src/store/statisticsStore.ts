/**
 * Statistics Store - Stage 5 State Management
 * Zustand store for robust statistics and machine learning features
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    StatisticsState,
    RobustRegressionConfig,
    AnomalyDetectionConfig,
    AnomalyResult,
    PopulationSeparationConfig,
    EnhancedClusteringConfig,
    ClassificationConfig,
    VarianceAnalysisResult,
    AnalysisHistoryItem,
} from '../types/statistics';
import {
    performRobustRegression,
    detectAnomalies,
    detectMahalanobisOutliers,
    separatePopulations,
    performClustering,
    performAmalgamationClustering,
    performClassification,
} from '../utils/statistics';
import { useAppStore } from './appStore';

interface StatisticsActions {
    // Tab navigation
    setActiveTab: (tab: StatisticsState['activeTab']) => void;

    // Robust Regression
    setRegressionConfig: (config: RobustRegressionConfig | null) => void;
    runRegression: () => Promise<void>;
    clearRegressionResult: () => void;

    // Anomaly Detection
    addAnomalyConfig: (config: AnomalyDetectionConfig) => void;
    removeAnomalyConfig: (index: number) => void;
    runAnomalyDetection: () => Promise<void>;
    clearAnomalyResults: () => void;

    // Population Separation
    setPopulationConfig: (config: PopulationSeparationConfig | null) => void;
    runPopulationSeparation: () => Promise<void>;
    clearPopulationResult: () => void;

    // Clustering
    setClusteringConfig: (config: EnhancedClusteringConfig | null) => void;
    runClustering: () => Promise<void>;
    runAmalgamationClustering: (elements: string[]) => Promise<void>;
    clearClusteringResult: () => void;

    // Classification
    setClassificationConfig: (config: ClassificationConfig | null) => void;
    runClassification: () => Promise<void>;
    clearClassificationResult: () => void;

    // Variance Analysis
    runVarianceAnalysis: (columns: string[]) => Promise<void>;
    clearVarianceAnalysis: () => void;

    // Mahalanobis Distance
    runMahalanobisOutliers: (columns: string[], useRobust?: boolean) => Promise<void>;
    clearMahalanobisResult: () => void;

    // History
    clearHistory: () => void;

    // Reset
    reset: () => void;
}

const initialState: StatisticsState = {
    regressionConfig: null,
    regressionResult: null,
    anomalyConfigs: [],
    anomalyResults: [],
    populationConfig: null,
    populationResult: null,
    clusteringConfig: null,
    clusteringResult: null,
    amalgamationResult: null,
    classificationConfig: null,
    classificationResult: null,
    varianceAnalysisResult: null,
    mahalanobisResult: null,
    analysisHistory: [],
    activeTab: 'regression',
    isProcessing: false,
    error: null,
};

export const useStatisticsStore = create<StatisticsState & StatisticsActions>()(
    persist(
        (set, get) => ({
            ...initialState,

            // Tab navigation
            setActiveTab: (tab) => set({ activeTab: tab }),

            // ================================================================
            // ROBUST REGRESSION
            // ================================================================
            setRegressionConfig: (config) => set({ regressionConfig: config }),

            runRegression: async () => {
                const { regressionConfig } = get();
                if (!regressionConfig) {
                    set({ error: 'No regression configuration set' });
                    return;
                }

                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    const result = performRobustRegression(data, regressionConfig);

                    // Add to history
                    const historyItem: AnalysisHistoryItem = {
                        id: `reg-${Date.now()}`,
                        timestamp: new Date(),
                        type: 'regression',
                        config: regressionConfig,
                        resultSummary: `${regressionConfig.method.toUpperCase()}: R² = ${
                            'groups' in result
                                ? 'grouped'
                                : result.rSquared.toFixed(3)
                        }`,
                    };

                    set(state => ({
                        regressionResult: result,
                        isProcessing: false,
                        analysisHistory: [historyItem, ...state.analysisHistory].slice(0, 20),
                    }));
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Regression failed',
                        isProcessing: false,
                    });
                }
            },

            clearRegressionResult: () => set({ regressionResult: null }),

            // ================================================================
            // ANOMALY DETECTION
            // ================================================================
            addAnomalyConfig: (config) => set(state => ({
                anomalyConfigs: [...state.anomalyConfigs, config],
            })),

            removeAnomalyConfig: (index) => set(state => ({
                anomalyConfigs: state.anomalyConfigs.filter((_, i) => i !== index),
            })),

            runAnomalyDetection: async () => {
                const { anomalyConfigs } = get();
                if (anomalyConfigs.length === 0) {
                    set({ error: 'No anomaly detection configurations set' });
                    return;
                }

                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    const results: AnomalyResult[] = [];
                    for (const config of anomalyConfigs) {
                        const result = detectAnomalies(data, config);
                        results.push(result);
                    }

                    // Add to history
                    const totalAnomalies = results.reduce((sum, r) => sum + r.statistics.nAnomalies, 0);
                    const historyItem: AnalysisHistoryItem = {
                        id: `anom-${Date.now()}`,
                        timestamp: new Date(),
                        type: 'anomaly',
                        config: anomalyConfigs,
                        resultSummary: `${anomalyConfigs.length} columns, ${totalAnomalies} anomalies detected`,
                    };

                    set(state => ({
                        anomalyResults: results,
                        isProcessing: false,
                        analysisHistory: [historyItem, ...state.analysisHistory].slice(0, 20),
                    }));
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Anomaly detection failed',
                        isProcessing: false,
                    });
                }
            },

            clearAnomalyResults: () => set({ anomalyResults: [], anomalyConfigs: [] }),

            // ================================================================
            // POPULATION SEPARATION
            // ================================================================
            setPopulationConfig: (config) => set({ populationConfig: config }),

            runPopulationSeparation: async () => {
                const { populationConfig } = get();
                if (!populationConfig) {
                    set({ error: 'No population separation configuration set' });
                    return;
                }

                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    const result = separatePopulations(data, populationConfig);

                    // Add to history
                    const historyItem: AnalysisHistoryItem = {
                        id: `pop-${Date.now()}`,
                        timestamp: new Date(),
                        type: 'population',
                        config: populationConfig,
                        resultSummary: `${result.nPopulations} populations detected in ${populationConfig.column}`,
                    };

                    set(state => ({
                        populationResult: result,
                        isProcessing: false,
                        analysisHistory: [historyItem, ...state.analysisHistory].slice(0, 20),
                    }));
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Population separation failed',
                        isProcessing: false,
                    });
                }
            },

            clearPopulationResult: () => set({ populationResult: null }),

            // ================================================================
            // CLUSTERING
            // ================================================================
            setClusteringConfig: (config) => set({ clusteringConfig: config }),

            runClustering: async () => {
                const { clusteringConfig } = get();
                if (!clusteringConfig) {
                    set({ error: 'No clustering configuration set' });
                    return;
                }

                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    const result = performClustering(data, clusteringConfig);

                    // Add to history
                    const historyItem: AnalysisHistoryItem = {
                        id: `clust-${Date.now()}`,
                        timestamp: new Date(),
                        type: 'clustering',
                        config: clusteringConfig,
                        resultSummary: `${clusteringConfig.method}: k=${result.k}, silhouette=${
                            result.avgSilhouette?.toFixed(3) || 'N/A'
                        }`,
                    };

                    set(state => ({
                        clusteringResult: result,
                        isProcessing: false,
                        analysisHistory: [historyItem, ...state.analysisHistory].slice(0, 20),
                    }));
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Clustering failed',
                        isProcessing: false,
                    });
                }
            },

            runAmalgamationClustering: async (elements) => {
                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    const result = performAmalgamationClustering(data, { elements, method: 'variance-explained' });

                    set({
                        amalgamationResult: result,
                        isProcessing: false,
                    });
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Amalgamation clustering failed',
                        isProcessing: false,
                    });
                }
            },

            clearClusteringResult: () => set({ clusteringResult: null, amalgamationResult: null }),

            // ================================================================
            // CLASSIFICATION
            // ================================================================
            setClassificationConfig: (config) => set({ classificationConfig: config }),

            runClassification: async () => {
                const { classificationConfig } = get();
                if (!classificationConfig) {
                    set({ error: 'No classification configuration set' });
                    return;
                }

                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    const result = performClassification(data, classificationConfig);

                    // Add to history
                    const accuracy = result.testConfusionMatrix?.accuracy;
                    const historyItem: AnalysisHistoryItem = {
                        id: `class-${Date.now()}`,
                        timestamp: new Date(),
                        type: 'classification',
                        config: classificationConfig,
                        resultSummary: `${classificationConfig.method}: accuracy=${
                            accuracy?.toFixed(3) || 'N/A'
                        }`,
                    };

                    set(state => ({
                        classificationResult: result,
                        isProcessing: false,
                        analysisHistory: [historyItem, ...state.analysisHistory].slice(0, 20),
                    }));
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Classification failed',
                        isProcessing: false,
                    });
                }
            },

            clearClassificationResult: () => set({ classificationResult: null }),

            // ================================================================
            // VARIANCE ANALYSIS
            // ================================================================
            runVarianceAnalysis: async (columns) => {
                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    // Calculate pairwise logratio variances
                    const logratios: VarianceAnalysisResult['logratios'] = [];

                    for (let i = 0; i < columns.length; i++) {
                        for (let j = i + 1; j < columns.length; j++) {
                            const col1 = columns[i];
                            const col2 = columns[j];

                            // Calculate log(col1/col2) for all valid rows
                            const values: number[] = [];
                            for (const row of data) {
                                const v1 = parseFloat(row[col1]);
                                const v2 = parseFloat(row[col2]);
                                if (v1 > 0 && v2 > 0) {
                                    values.push(Math.log(v1 / v2));
                                }
                            }

                            if (values.length > 2) {
                                const mean = values.reduce((a, b) => a + b, 0) / values.length;
                                const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);

                                logratios.push({
                                    numerator: col1,
                                    denominator: col2,
                                    contributedVariance: variance,
                                    explainedVariance: 0, // Would need more complex calculation
                                    rank: 0,
                                });
                            }
                        }
                    }

                    // Calculate total variance and contributions
                    const totalVariance = logratios.reduce((sum, lr) => sum + lr.contributedVariance, 0);

                    // Normalize to percentages and rank
                    logratios.forEach(lr => {
                        lr.contributedVariance = totalVariance > 0 ? (lr.contributedVariance / totalVariance) * 100 : 0;
                    });
                    logratios.sort((a, b) => b.contributedVariance - a.contributedVariance);
                    logratios.forEach((lr, i) => lr.rank = i + 1);

                    const result: VarianceAnalysisResult = {
                        logratios,
                        totalVariance,
                        topContributors: logratios.slice(0, 10).map(lr => `log(${lr.numerator}/${lr.denominator})`),
                        topExplainers: [],
                    };

                    set({
                        varianceAnalysisResult: result,
                        isProcessing: false,
                    });
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Variance analysis failed',
                        isProcessing: false,
                    });
                }
            },

            clearVarianceAnalysis: () => set({ varianceAnalysisResult: null }),

            // ================================================================
            // MAHALANOBIS DISTANCE
            // ================================================================
            runMahalanobisOutliers: async (columns, useRobust = true) => {
                set({ isProcessing: true, error: null });

                try {
                    const data = useAppStore.getState().data;
                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    const result = detectMahalanobisOutliers(data, {
                        columns,
                        useRobustEstimate: useRobust,
                        transformationType: 'zscore',
                    });

                    set({
                        mahalanobisResult: result,
                        isProcessing: false,
                    });
                } catch (err) {
                    set({
                        error: err instanceof Error ? err.message : 'Mahalanobis outlier detection failed',
                        isProcessing: false,
                    });
                }
            },

            clearMahalanobisResult: () => set({ mahalanobisResult: null }),

            // ================================================================
            // HISTORY & RESET
            // ================================================================
            clearHistory: () => set({ analysisHistory: [] }),

            reset: () => set(initialState),
        }),
        {
            name: 'statistics-storage',
            partialize: (state) => ({
                analysisHistory: state.analysisHistory.slice(0, 10),
                activeTab: state.activeTab,
            }),
        }
    )
);

// Selector hooks
export const useRegressionResult = () => useStatisticsStore(state => state.regressionResult);
export const useAnomalyResults = () => useStatisticsStore(state => state.anomalyResults);
export const usePopulationResult = () => useStatisticsStore(state => state.populationResult);
export const useClusteringResult = () => useStatisticsStore(state => state.clusteringResult);
export const useClassificationResult = () => useStatisticsStore(state => state.classificationResult);
export const useStatisticsProcessing = () => useStatisticsStore(state => state.isProcessing);
export const useStatisticsError = () => useStatisticsStore(state => state.error);
