/**
 * The analysis tasks that can run off the main thread.
 *
 * One table shared by workers/analysis.worker.ts and the main-thread fallback
 * in utils/analysisWorker.ts, so adding a task is a single entry. Everything
 * imported here must stay pure (no DOM, no stores) and every payload/result
 * must be structured-clonable (plain data / typed arrays, no functions).
 */
import { fullPCAWithTransform } from './calculations/pcaAnalysis';
import { pca2d } from './calculations/eigen';
import { performClustering } from './statistics/clustering';
import { detectAnomalies } from './statistics/anomalyDetection';
import { separatePopulations } from './statistics/populationSeparation';
import { performRobustRegression } from './statistics/robustRegression';
import { calculateVectoring } from './depositVectoring';
import { factorAnalysis } from './statistics/factorAnalysis';

export const ANALYSIS_TASKS = {
    fullPCA: (p: any) => fullPCAWithTransform(p.data, p.columns, p.nComponents, p.zeroStrategy, p.displayNames, p.transform),
    clustering: (p: any) => performClustering(p.data, p.config),
    pca2d: (p: any) => pca2d(p.matrix),
    detectAnomalies: (p: any) => detectAnomalies(p.data, p.config),
    separatePopulations: (p: any) => separatePopulations(p.data, p.config),
    robustRegression: (p: any) => performRobustRegression(p.data, p.config),
    vectoring: (p: any) => calculateVectoring(p.data, p.columns, p.depositType, p.geochemMappings),
    factorAnalysis: (p: any) => factorAnalysis(p.data, p.columns, p.options),
};

export type AnalysisKind = keyof typeof ANALYSIS_TASKS;

export function runAnalysisTask(kind: AnalysisKind, payload: unknown): unknown {
    const task = ANALYSIS_TASKS[kind];
    if (!task) throw new Error(`Unknown analysis kind: ${kind}`);
    return task(payload);
}
