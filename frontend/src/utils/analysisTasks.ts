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
import { selectGmm } from './statistics/gaussianMixture';
import { evaluateScore, screenVariables } from './statistics/targetEvaluation';
import { lagOneTest } from './statistics/sequence';
import { variationMatrix, pairStability } from './statistics/variationMatrix';
import { standardizeColumn } from './statistics/groupStandardization';

export const ANALYSIS_TASKS = {
    fullPCA: (p: any) => fullPCAWithTransform(p.data, p.columns, p.nComponents, p.zeroStrategy, p.displayNames, p.transform, p.references),
    clustering: (p: any) => performClustering(p.data, p.config),
    pca2d: (p: any) => pca2d(p.matrix),
    detectAnomalies: (p: any) => detectAnomalies(p.data, p.config),
    separatePopulations: (p: any) => separatePopulations(p.data, p.config),
    robustRegression: (p: any) => performRobustRegression(p.data, p.config),
    vectoring: (p: any) => calculateVectoring(p.data, p.columns, p.depositType, p.geochemMappings),
    factorAnalysis: (p: any) => factorAnalysis(p.data, p.columns, p.options),
    gmmSelect: (p: any) => selectGmm(p.config),
    evaluateScores: (p: any) => (p.scores as Array<{ name: string; values: Float64Array }>)
        .map(s => ({ name: s.name, result: evaluateScore(s.values, p.target, p.options) })),
    screenVariables: (p: any) => screenVariables(p.features, p.target, p.options),
    lagOneTests: (p: any) => (p.columns as Array<{ name: string; values: Float64Array }>)
        .map(c => ({ name: c.name, result: lagOneTest(c.values, p.options) })),
    variationMatrix: (p: any) => variationMatrix(p.parts, p.options),
    pairStability: (p: any) => pairStability(p.parts, p.maskA, p.maskB, p.options),
    standardizeColumns: (p: any) => (p.columns as Array<{ name: string; values: Float64Array; censored: Uint8Array | null }>)
        .map(c => ({ name: c.name, result: standardizeColumn(c.values, { ...p.options, censored: c.censored }) })),
};

export type AnalysisKind = keyof typeof ANALYSIS_TASKS;

export function runAnalysisTask(kind: AnalysisKind, payload: unknown): unknown {
    const task = ANALYSIS_TASKS[kind];
    if (!task) throw new Error(`Unknown analysis kind: ${kind}`);
    return task(payload);
}
