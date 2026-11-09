/**
 * Add PC1..n and negPC1..n score columns from the PCA result in the
 * transformation store (shared by the PCA workflow and the PCA results window).
 *
 * Score columns of different PCAs must not silently overwrite each other
 * (e.g. an IES-subset PCA after a whole-dataset PCA): when the target names
 * already hold another PCA's scores the call reports a conflict, and the
 * caller either replaces them or picks a prefix ("IES PC1", "IES negPC1").
 */
import { useAppStore } from '../../../store/appStore';
import { useTransformationStore } from '../../../store/transformationStore';

export interface AddPcScoresOptions {
  /** Column name prefix; '' gives PC1, negPC1 ... */
  prefix?: string;
  /** Overwrite score columns of another PCA (and drop its higher PCs) */
  replace?: boolean;
}

export interface AddPcScoresResult {
  ok: boolean;
  message: string;
  /** Existing columns from a different PCA that would be overwritten */
  conflict?: string[];
}

export const pcScoreName = (prefix: string, component: number, negative = false) =>
  `${prefix.trim() ? `${prefix.trim()} ` : ''}${negative ? 'neg' : ''}PC${component}`;

/** Fingerprint of a PCA run, stored in each score column's derivation. */
function runKey(elements: string[], transform: string, nSamples: number, eigen1: number): string {
  return `${transform}|${nSamples}|${eigen1.toPrecision(10)}|${elements.join(',')}`;
}

export function addPcScoresToData(opts: AddPcScoresOptions = {}): AddPcScoresResult {
  const prefix = (opts.prefix ?? '').trim();
  const { fullPcaResult, pcaInputIndices, pcaSelectedElements, pcaUi } = useTransformationStore.getState();
  const app = useAppStore.getState();
  if (!fullPcaResult) return { ok: false, message: 'Run PCA first.' };

  const rowCount = app.columnarData.rowCount;
  const numPCs = Math.min(pcaUi.nComponents, fullPcaResult.eigenvalues.length);
  const { keptIndices, scores } = fullPcaResult;
  if (!pcaInputIndices || keptIndices.length !== scores.length || pcaInputIndices.some(i => i >= rowCount)) {
    // Refuse to write misaligned scores
    return { ok: false, message: 'Could not add PC scores — row mapping is inconsistent. Please re-run PCA.' };
  }

  const elements = fullPcaResult.columns ?? pcaSelectedElements;
  const transform = fullPcaResult.transform ?? 'clr';
  const key = runKey(elements, transform, fullPcaResult.nSamples, fullPcaResult.eigenvalues[0] ?? 0);

  // Score columns of this prefix (any component number) already in the data
  const pattern = new RegExp(`^${prefix ? `${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ` : ''}(neg)?PC(\\d+)$`);
  const existing = app.columns.filter(c => pattern.test(c.name));
  const foreign = existing.filter(c => (c.derivation?.params as { run?: string } | undefined)?.run !== key);
  if (foreign.length && !opts.replace) {
    return {
      ok: false,
      conflict: foreign.map(c => c.name),
      message: `${foreign.length} columns (${foreign.slice(0, 3).map(c => c.name).join(', ')}${foreign.length > 3 ? ', …' : ''}) hold scores of a different PCA.`,
    };
  }

  for (let i = 0; i < numPCs; i++) {
    const pcValues: (number | null)[] = new Array(rowCount).fill(NaN);
    const negPcValues: (number | null)[] = new Array(rowCount).fill(NaN);
    // Row j of the scores is dataset row pcaInputIndices[keptIndices[j]];
    // rows dropped (missing values, not visible) stay empty
    for (let j = 0; j < scores.length; j++) {
      const globalIdx = pcaInputIndices[keptIndices[j]];
      if (globalIdx == null || globalIdx < 0) continue;
      pcValues[globalIdx] = scores[j][i];
      negPcValues[globalIdx] = -scores[j][i];
    }
    const derivation = {
      kind: 'pca' as const,
      description: `PCA (transform ${transform}) component ${i + 1} of ${elements.length} variables`,
      params: { component: i + 1, elements, explainedVariance: fullPcaResult.eigenvalues[i], transform, run: key },
      created: new Date().toISOString(),
    };
    app.addColumn(pcScoreName(prefix, i + 1), pcValues, 'numeric', 'PCA', 'pca' as any, undefined, derivation);
    app.addColumn(pcScoreName(prefix, i + 1, true), negPcValues, 'numeric', 'PCA', 'pca' as any, undefined, { ...derivation, description: `Negated ${derivation.description}` });
  }

  // Higher components left over from an earlier PCA with more PCs would be stale
  const stale = existing.map(c => c.name).filter(n => Number(pattern.exec(n)?.[2]) > numPCs);
  if (stale.length) useAppStore.getState().removeColumns(stale);
  useTransformationStore.getState().setPcScorePrefix(prefix);

  const first = pcScoreName(prefix, 1), last = pcScoreName(prefix, numPCs);
  return {
    ok: true,
    message: `Added ${numPCs * 2} columns (${first}-${last} and the neg columns) to the dataset (${scores.length} of ${rowCount} samples populated)`
      + (stale.length ? `; removed ${stale.length} stale higher-PC columns` : ''),
  };
}
