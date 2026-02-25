/**
 * QA/QC Detection Utilities
 * Auto-detect QC samples by naming patterns and identify duplicate pairs
 */

import {
  QCSampleType,
  QCSample,
  DuplicatePair,
  DEFAULT_QC_PATTERNS,
  QCDetectionPattern,
} from '../types/qaqc';

// ============================================================================
// SAMPLE TYPE DETECTION
// ============================================================================

/**
 * Detect QC sample type from sample ID using pattern matching
 */
export function detectQCSampleType(
  sampleId: string,
  patterns: QCDetectionPattern[] = DEFAULT_QC_PATTERNS
): QCSampleType | null {
  if (!sampleId) return null;

  const normalizedId = sampleId.trim();

  for (const patternDef of patterns) {
    for (const pattern of patternDef.patterns) {
      if (pattern.test(normalizedId)) {
        return patternDef.type;
      }
    }
  }

  return null;
}

/**
 * Extract standard name from sample ID
 * e.g., "STD-OREAS-45e" -> "OREAS-45e"
 * e.g., "CRM_GBM301-12" -> "GBM301-12"
 */
export function extractStandardName(sampleId: string): string | null {
  if (!sampleId) return null;

  // Common prefixes to remove
  const prefixes = [
    /^STD[-_]?/i,
    /^CRM[-_]?/i,
    /^SRM[-_]?/i,
    /^REF[-_]?/i,
  ];

  let name = sampleId.trim();

  for (const prefix of prefixes) {
    if (prefix.test(name)) {
      name = name.replace(prefix, '');
      break;
    }
  }

  // Extract the core standard name (remove trailing numbers that might be insertion numbers)
  // e.g., "OREAS-45e-001" -> "OREAS-45e"
  const match = name.match(/^([A-Za-z]+[-_]?\d+[A-Za-z]?)/i);
  if (match) {
    return match[1].toUpperCase();
  }

  return name.toUpperCase() || null;
}

/**
 * Detect all QC samples in a dataset
 */
export function detectQCSamples(
  data: Record<string, any>[],
  sampleIdColumn: string,
  patterns: QCDetectionPattern[] = DEFAULT_QC_PATTERNS
): QCSample[] {
  const qcSamples: QCSample[] = [];

  data.forEach((row, index) => {
    const sampleId = row[sampleIdColumn];
    if (!sampleId) return;

    const qcType = detectQCSampleType(String(sampleId), patterns);

    if (qcType) {
      const qcSample: QCSample = {
        rowIndex: index,
        sampleId: String(sampleId),
        qcType,
        isManuallyTagged: false,
      };

      // Extract standard name for standards
      if (qcType === 'standard') {
        qcSample.standardName = extractStandardName(String(sampleId)) || undefined;
      }

      qcSamples.push(qcSample);
    }
  });

  return qcSamples;
}

// ============================================================================
// DUPLICATE PAIR DETECTION
// ============================================================================

/**
 * Find the base sample ID by removing duplicate suffixes.
 * Suffix stripping is scoped to the requested duplicate type to prevent
 * a single sample from being triple-counted across field/pulp/core.
 *
 * Fix 1.1: Type-aware suffix stripping
 * Fix 1.2: Bare A/B patterns removed - require separator or digit before A/B
 */
export function getBaseSampleId(
  sampleId: string,
  duplicateType?: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate'
): string {
  if (!sampleId) return '';

  let base = sampleId.trim();

  // Suffix patterns mapped to duplicate types
  // Each entry: [search pattern, replacement string]
  const fieldSuffixes: [RegExp, string][] = [
    [/[-_]DUP$/i, ''],
    [/[-_]FD$/i, ''],
    [/[-_]A$/i, ''],
    [/[-_]B$/i, ''],
    [/(\d)[AB]$/i, '$1'],  // Strip just the A/B letter, keep the digit
  ];

  const pulpSuffixes: [RegExp, string][] = [
    [/[-_]PD$/i, ''],
    [/[-_]RPT$/i, ''],
    [/[-_]REP$/i, ''],
  ];

  const coreSuffixes: [RegExp, string][] = [
    [/[-_]CD$/i, ''],
    [/[-_]QC$/i, ''],
  ];

  let suffixes: [RegExp, string][];
  if (!duplicateType) {
    // When no type specified, try all (used by general sample detection)
    suffixes = [...fieldSuffixes, ...pulpSuffixes, ...coreSuffixes];
  } else {
    switch (duplicateType) {
      case 'field_duplicate': suffixes = fieldSuffixes; break;
      case 'pulp_duplicate': suffixes = pulpSuffixes; break;
      case 'core_duplicate': suffixes = coreSuffixes; break;
    }
  }

  for (const [pattern, replacement] of suffixes) {
    if (pattern.test(base)) {
      base = base.replace(pattern, replacement);
      break;
    }
  }

  return base;
}

/**
 * Detect duplicate pairs in dataset
 * Handles multiple naming conventions:
 * - Suffix pairs: SAMPLE-001 / SAMPLE-001-DUP
 * - Letter pairs: SAMPLE-001A / SAMPLE-001B (field duplicates only)
 * - Explicit duplicate IDs via a dedicated pair column
 *
 * Fix 1.1: Suffix stripping now scoped to the requested duplicate type
 * Feature 2.5: Support linking via a dedicated pair column
 */
export function detectDuplicatePairs(
  data: Record<string, any>[],
  sampleIdColumn: string,
  duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate' = 'field_duplicate',
  pairColumn?: string
): DuplicatePair[] {
  // If a dedicated pair column is provided, use column-based pairing
  if (pairColumn) {
    return detectDuplicatePairsByColumn(data, sampleIdColumn, pairColumn, duplicateType);
  }

  const pairs: DuplicatePair[] = [];
  const sampleMap = new Map<string, { index: number; id: string }>();

  // Build map of base IDs to samples (type-aware suffix stripping)
  data.forEach((row, index) => {
    const sampleId = row[sampleIdColumn];
    if (!sampleId) return;

    const id = String(sampleId).trim();
    const baseId = getBaseSampleId(id, duplicateType);

    // Store if this is the original (no suffix stripped) or if not yet stored
    if (id === baseId || !sampleMap.has(baseId)) {
      sampleMap.set(baseId, { index, id });
    }
  });

  // Find duplicates by matching base IDs
  data.forEach((row, index) => {
    const sampleId = row[sampleIdColumn];
    if (!sampleId) return;

    const id = String(sampleId).trim();
    const baseId = getBaseSampleId(id, duplicateType);

    // Check if this is a duplicate (has suffix and different from stored)
    if (id !== baseId) {
      const original = sampleMap.get(baseId);
      if (original && original.index !== index) {
        pairs.push({
          originalIndex: original.index,
          duplicateIndex: index,
          originalId: original.id,
          duplicateId: id,
          duplicateType,
        });
      }
    }
  });

  // A/B letter pairs only for field duplicates
  if (duplicateType === 'field_duplicate') {
    const letterPairs = detectLetterPairs(data, sampleIdColumn, duplicateType);
    pairs.push(...letterPairs);
  }

  // Remove duplicates (in case both methods found same pair)
  const uniquePairs = pairs.filter((pair, idx, arr) =>
    arr.findIndex(p =>
      p.originalIndex === pair.originalIndex &&
      p.duplicateIndex === pair.duplicateIndex
    ) === idx
  );

  return uniquePairs;
}

/**
 * Detect A/B letter pairs specifically.
 * Fix 1.2: Require separator or digit before A/B to avoid matching
 * legitimate samples like "HZBA" or "RC12B".
 */
function detectLetterPairs(
  data: Record<string, any>[],
  sampleIdColumn: string,
  duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate'
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  // Require separator or digit immediately before A/B
  const aPattern = /(.+(?:[-_]|\d))A$/i;
  const bPattern = /(.+(?:[-_]|\d))B$/i;

  // Find all samples ending in A
  const aSamples = new Map<string, { index: number; id: string }>();

  data.forEach((row, index) => {
    const sampleId = row[sampleIdColumn];
    if (!sampleId) return;

    const id = String(sampleId).trim();
    const match = id.match(aPattern);
    if (match) {
      const base = match[1];
      aSamples.set(base.toUpperCase(), { index, id });
    }
  });

  // Find matching B samples
  data.forEach((row, index) => {
    const sampleId = row[sampleIdColumn];
    if (!sampleId) return;

    const id = String(sampleId).trim();
    const match = id.match(bPattern);
    if (match) {
      const base = match[1];
      const aSample = aSamples.get(base.toUpperCase());
      if (aSample) {
        pairs.push({
          originalIndex: aSample.index,
          duplicateIndex: index,
          originalId: aSample.id,
          duplicateId: id,
          duplicateType,
        });
      }
    }
  });

  return pairs;
}

// ============================================================================
// COLUMN-BASED DUPLICATE DETECTION (Feature 2.5)
// ============================================================================

/**
 * Detect duplicate pairs using a dedicated pair column (e.g., "QC_PAIR", "DUP_OF").
 * The column contains the original sample ID that each duplicate is linked to.
 */
function detectDuplicatePairsByColumn(
  data: Record<string, any>[],
  sampleIdColumn: string,
  pairColumn: string,
  duplicateType: 'field_duplicate' | 'pulp_duplicate' | 'core_duplicate'
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];

  // Build index: sampleId -> rowIndex
  const sampleIndex = new Map<string, number>();
  data.forEach((row, index) => {
    const sampleId = row[sampleIdColumn];
    if (sampleId) {
      sampleIndex.set(String(sampleId).trim().toUpperCase(), index);
    }
  });

  // Find pairs via pair column
  data.forEach((row, index) => {
    const pairValue = row[pairColumn];
    if (!pairValue) return;

    const originalId = String(pairValue).trim().toUpperCase();
    const originalIndex = sampleIndex.get(originalId);

    if (originalIndex !== undefined && originalIndex !== index) {
      const sampleId = row[sampleIdColumn];
      pairs.push({
        originalIndex,
        duplicateIndex: index,
        originalId: String(data[originalIndex][sampleIdColumn]).trim(),
        duplicateId: String(sampleId).trim(),
        duplicateType,
      });
    }
  });

  return pairs;
}

// ============================================================================
// BATCH DETECTION
// ============================================================================

/**
 * Extract batch ID from sample ID or dedicated column
 * Common formats:
 * - Prefix: "BATCH001-SAMPLE-001"
 * - Suffix: "SAMPLE-001_B001"
 * - Separate column
 */
export function extractBatchId(
  sampleId: string,
  batchColumn?: string,
  rowData?: Record<string, any>
): string | null {
  // First try dedicated batch column
  if (batchColumn && rowData && rowData[batchColumn]) {
    return String(rowData[batchColumn]);
  }

  if (!sampleId) return null;

  // Try to extract from sample ID
  // Pattern: BATCH followed by digits
  const batchMatch = sampleId.match(/BATCH[-_]?(\d+)/i);
  if (batchMatch) {
    return `BATCH${batchMatch[1]}`;
  }

  // Pattern: _B followed by digits at end
  const suffixMatch = sampleId.match(/[-_]B(\d+)$/i);
  if (suffixMatch) {
    return `B${suffixMatch[1]}`;
  }

  return null;
}

/**
 * Assign batch IDs to samples based on sequence or detected patterns
 * If no batch info found, assign by position (every N samples = new batch)
 */
export function assignBatches(
  data: Record<string, any>[],
  sampleIdColumn: string,
  batchColumn?: string,
  defaultBatchSize: number = 50
): Map<number, string> {
  const batches = new Map<number, string>();
  let currentBatch = 1;
  let samplesInBatch = 0;

  data.forEach((row, index) => {
    const sampleId = row[sampleIdColumn];
    const detectedBatch = extractBatchId(String(sampleId || ''), batchColumn, row);

    if (detectedBatch) {
      batches.set(index, detectedBatch);
    } else {
      // Assign by position
      if (samplesInBatch >= defaultBatchSize) {
        currentBatch++;
        samplesInBatch = 0;
      }
      batches.set(index, `AUTO_BATCH_${currentBatch}`);
      samplesInBatch++;
    }
  });

  return batches;
}

// ============================================================================
// QC INSERTION RATE
// ============================================================================

/**
 * Calculate QC sample insertion rate
 */
export function calculateInsertionRate(
  totalSamples: number,
  qcSamples: QCSample[]
): { overall: number; byType: Record<QCSampleType, number> } {
  const overall = totalSamples > 0 ? (qcSamples.length / totalSamples) * 100 : 0;

  const byType: Record<QCSampleType, number> = {
    standard: 0,
    blank: 0,
    field_duplicate: 0,
    pulp_duplicate: 0,
    core_duplicate: 0,
    unknown: 0,
  };

  const typeCounts: Record<QCSampleType, number> = {
    standard: 0,
    blank: 0,
    field_duplicate: 0,
    pulp_duplicate: 0,
    core_duplicate: 0,
    unknown: 0,
  };

  qcSamples.forEach(sample => {
    typeCounts[sample.qcType]++;
  });

  for (const type of Object.keys(typeCounts) as QCSampleType[]) {
    byType[type] = totalSamples > 0 ? (typeCounts[type] / totalSamples) * 100 : 0;
  }

  return { overall, byType };
}

// ============================================================================
// SAMPLE ID COLUMN DETECTION
// ============================================================================

/**
 * Auto-detect which column contains sample IDs
 * Looks for common naming patterns
 */
export function detectSampleIdColumn(columns: { name: string; type: string }[]): string | null {
  const sampleIdPatterns = [
    /^sample[-_]?id$/i,
    /^sampleid$/i,
    /^sample[-_]?no$/i,
    /^sample[-_]?number$/i,
    /^sample$/i,
    /^id$/i,
    /^sampid$/i,
    /^lab[-_]?id$/i,
    /^field[-_]?id$/i,
    /^hole[-_]?id$/i,  // For drillhole data
  ];

  for (const pattern of sampleIdPatterns) {
    const match = columns.find(col => pattern.test(col.name));
    if (match) {
      return match.name;
    }
  }

  // Fallback: first text/string column
  const textCol = columns.find(col =>
    col.type === 'text' || col.type === 'string' || col.type === 'categorical'
  );

  return textCol?.name || null;
}
