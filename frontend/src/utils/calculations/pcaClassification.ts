/**
 * PCA Classification Utility
 *
 * Classifies samples based on PC scores and selected element associations.
 * Uses percentile-based thresholds derived from loading ranges to determine
 * which samples are classified into a named association category.
 */

export interface ClassificationConfig {
  /** PC number (1-based) */
  pcNumber: number;
  /** Which side of the PC the association is on */
  side: 'positive' | 'negative';
  /** Name for the classification (e.g., "Felsic") */
  associationName: string;
  /** Percentile threshold (10-90) */
  thresholdPercentile: number;
}

export interface ClassificationPreview {
  totalSamples: number;
  classifiedCount: number;
  thresholdValue: number;
}

/**
 * Compute the default percentile threshold from the minimum absolute loading
 * of the selected elements.
 *
 * Higher minLoading = more selective = fewer samples classified.
 * - minLoading 0.50 → 50th percentile → top 50% classified
 * - minLoading 0.80 → 80th percentile → top 20% classified
 *
 * Clamped to 10-90 range.
 */
export function getDefaultThreshold(minAbsLoading: number): number {
  const percentile = Math.round(minAbsLoading * 100);
  return Math.max(10, Math.min(90, percentile));
}

/**
 * Compute the percentile value from a sorted array of numbers.
 */
function percentileValue(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const idx = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Preview classification without modifying data.
 * Returns total samples, count that would be classified, and the threshold value.
 */
export function previewClassification(
  pcScores: number[],
  side: 'positive' | 'negative',
  thresholdPercentile: number
): ClassificationPreview {
  const validScores = pcScores.filter((v) => typeof v === 'number' && !isNaN(v));
  const sorted = [...validScores].sort((a, b) => a - b);

  const thresholdValue = percentileValue(sorted, thresholdPercentile);

  let classifiedCount: number;
  if (side === 'positive') {
    classifiedCount = validScores.filter((v) => v >= thresholdValue).length;
  } else {
    classifiedCount = validScores.filter((v) => v <= percentileValue(sorted, 100 - thresholdPercentile)).length;
  }

  return {
    totalSamples: validScores.length,
    classifiedCount,
    thresholdValue: side === 'positive' ? thresholdValue : percentileValue(sorted, 100 - thresholdPercentile),
  };
}

/**
 * Classify samples based on PC scores.
 * Returns an array of (string | null) where classified samples get the
 * association name and others get null.
 */
export function classifySamples(
  pcScores: (number | null | undefined)[],
  config: ClassificationConfig
): (string | null)[] {
  const validScores = pcScores
    .map((v) => (typeof v === 'number' && !isNaN(v) ? v : null))
    .filter((v): v is number => v !== null);

  const sorted = [...validScores].sort((a, b) => a - b);

  let thresholdValue: number;
  if (config.side === 'positive') {
    thresholdValue = percentileValue(sorted, config.thresholdPercentile);
  } else {
    thresholdValue = percentileValue(sorted, 100 - config.thresholdPercentile);
  }

  return pcScores.map((score) => {
    if (score == null || isNaN(score)) return null;

    if (config.side === 'positive') {
      return score >= thresholdValue ? config.associationName : null;
    } else {
      return score <= thresholdValue ? config.associationName : null;
    }
  });
}

/**
 * Merge new classification values with existing column values.
 * New non-null values overwrite, existing values are preserved where new is null.
 */
export function mergeClassifications(
  existingValues: (string | null | undefined)[],
  newValues: (string | null)[]
): string[] {
  const length = Math.max(existingValues.length, newValues.length);
  const merged: string[] = [];

  for (let i = 0; i < length; i++) {
    const newVal = i < newValues.length ? newValues[i] : null;
    const existingVal = i < existingValues.length ? existingValues[i] : null;
    merged.push(newVal ?? (existingVal as string) ?? '');
  }

  return merged;
}
