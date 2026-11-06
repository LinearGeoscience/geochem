/**
 * Add PC1..n and negPC1..n score columns from the PCA result in the
 * transformation store (shared by the PCA workflow and the PCA results window).
 */
import { useAppStore } from '../../../store/appStore';
import { useTransformationStore } from '../../../store/transformationStore';

export function addPcScoresToData(): { ok: boolean; message: string } {
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
      description: `PCA (transform ${fullPcaResult.transform ?? 'clr'}) component ${i + 1} of ${elements.length} variables`,
      params: { component: i + 1, elements, explainedVariance: fullPcaResult.eigenvalues[i], transform: fullPcaResult.transform ?? 'clr' },
      created: new Date().toISOString(),
    };
    app.addColumn(`PC${i + 1}`, pcValues, 'numeric', 'PCA', 'pca' as any, undefined, derivation);
    app.addColumn(`negPC${i + 1}`, negPcValues, 'numeric', 'PCA', 'pca' as any, undefined, { ...derivation, description: `Negated ${derivation.description}` });
  }
  return {
    ok: true,
    message: `Added ${numPCs * 2} columns (PC1-PC${numPCs} and negPC1-negPC${numPCs}) to the dataset (${scores.length} of ${rowCount} samples populated)`,
  };
}
