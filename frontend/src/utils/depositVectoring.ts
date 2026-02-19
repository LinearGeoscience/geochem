/**
 * Deposit-Specific Geochemical Vectoring Calculations
 * Comprehensive implementation based on research from multiple deposit types
 */

import {
  DepositType,
  VectoringIndicator,
  IndicatorThreshold,
  CalculatedIndicator,
  DepositConfig,
  VectoringResult,
  MissingIndicatorInfo,
  PorphyryFertilityResult,
  KomatiiteNiResult,
  CarlinGoldResult,
  LCTPegmatiteResult,
  ELEMENT_MAPPINGS,
} from '../types/vectoring';
import { ColumnGeochemMapping } from '../types/associations';

// ============================================================================
// CHONDRITE NORMALIZATION VALUES (McDonough & Sun 1995)
// ============================================================================

const CHONDRITE_VALUES: Record<string, number> = {
  La: 0.237, Ce: 0.613, Pr: 0.0928, Nd: 0.457, Sm: 0.148,
  Eu: 0.0563, Gd: 0.199, Tb: 0.0361, Dy: 0.246, Ho: 0.0546,
  Er: 0.160, Tm: 0.0247, Yb: 0.161, Lu: 0.0246
};

// Short element symbols that need strict matching to avoid false positives
const SHORT_SYMBOLS = new Set(['V', 'W', 'Y', 'U', 'F', 'P', 'K', 'S', 'B', 'C', 'N', 'O', 'I']);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Find column name in data that matches an element.
 * Uses geochemMappings (user-verified) when available, falls back to local ELEMENT_MAPPINGS
 * with strict matching to avoid false positives.
 */
export function findElementColumn(
  columns: string[],
  element: string,
  geochemMappings?: ColumnGeochemMapping[]
): string | null {
  // Strategy 1: Use geochemMappings if available (user has already verified these)
  if (geochemMappings && geochemMappings.length > 0) {
    const mapping = geochemMappings.find(m => {
      const detected = m.userOverride || m.detectedElement;
      return detected === element && !m.isExcluded;
    });
    if (mapping) {
      // Verify column exists in the data
      const exists = columns.find(c => c === mapping.originalName);
      if (exists) return exists;
    }
  }

  // Strategy 2: Strict local matching using ELEMENT_MAPPINGS
  const mapping = ELEMENT_MAPPINGS.find(m => m.standardName === element);
  if (!mapping) return null;

  const isShort = SHORT_SYMBOLS.has(element) || element.length <= 2;

  for (const alias of mapping.aliases) {
    // Exact match (case-insensitive)
    const exact = columns.find(col => col.toLowerCase() === alias.toLowerCase());
    if (exact) return exact;
  }

  for (const alias of mapping.aliases) {
    // Prefix match with separator (e.g., "Au_ppm", "Cu_pct", "Fe2O3_pct")
    const found = columns.find(col => {
      const lower = col.toLowerCase();
      const aliasLower = alias.toLowerCase();
      // Must start with alias followed by a separator character
      if (lower.startsWith(aliasLower)) {
        if (lower.length === aliasLower.length) return true;
        const nextChar = lower[aliasLower.length];
        return nextChar === '_' || nextChar === '-' || nextChar === ' ' || nextChar === '.';
      }
      return false;
    });
    if (found) return found;
  }

  // For longer element names (3+ chars), allow substring match only if not ambiguous
  if (!isShort) {
    for (const alias of mapping.aliases) {
      if (alias.length < 3) continue; // Skip short aliases even for longer elements
      const found = columns.find(col =>
        col.toLowerCase().includes(alias.toLowerCase())
      );
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get numeric values from data for a column
 */
export function getColumnValues(
  data: Record<string, any>[],
  column: string
): (number | null)[] {
  return data.map(row => {
    const val = row[column];
    if (val === null || val === undefined || val === '' || val === '<' || isNaN(Number(val))) {
      return null;
    }
    return Number(val);
  });
}

/**
 * Calculate basic statistics
 */
export function calculateStats(values: (number | null)[]): {
  min: number; max: number; mean: number; median: number; std: number; count: number; validCount: number;
} {
  const valid = values.filter((v): v is number => v !== null && !isNaN(v));
  if (valid.length === 0) {
    return { min: NaN, max: NaN, mean: NaN, median: NaN, std: NaN, count: values.length, validCount: 0 };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const sum = valid.reduce((a, b) => a + b, 0);
  const mean = sum / valid.length;
  const median = valid.length % 2 === 0
    ? (sorted[valid.length / 2 - 1] + sorted[valid.length / 2]) / 2
    : sorted[Math.floor(valid.length / 2)];
  const variance = valid.reduce((acc, v) => acc + (v - mean) ** 2, 0) / valid.length;

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median,
    std: Math.sqrt(variance),
    count: values.length,
    validCount: valid.length
  };
}

/**
 * Calculate ratio between two elements
 */
export function calculateRatio(
  data: Record<string, any>[],
  numeratorCol: string | null,
  denominatorCol: string | null
): (number | null)[] {
  if (!numeratorCol || !denominatorCol) {
    return data.map(() => null);
  }

  return data.map(row => {
    const num = Number(row[numeratorCol]);
    const den = Number(row[denominatorCol]);
    if (isNaN(num) || isNaN(den) || den === 0) return null;
    return num / den;
  });
}

/**
 * Interpret value against thresholds
 */
export function interpretThreshold(
  value: number | null,
  thresholds: IndicatorThreshold[]
): { interpretation: string; fertility: string | null; color: string } {
  if (value === null) {
    return { interpretation: 'No data', fertility: null, color: '#9ca3af' };
  }

  for (const t of thresholds) {
    let match = false;
    switch (t.operator) {
      case '<': match = value < t.value; break;
      case '<=': match = value <= t.value; break;
      case '>': match = value > t.value; break;
      case '>=': match = value >= t.value; break;
      case '==': match = value === t.value; break;
      case 'between':
        match = value >= t.value && value <= (t.upperValue ?? t.value);
        break;
    }
    if (match) {
      return {
        interpretation: t.interpretation,
        fertility: t.fertility || null,
        color: t.color
      };
    }
  }

  return { interpretation: 'Unknown', fertility: null, color: '#9ca3af' };
}

// ============================================================================
// GENERIC INDICATOR BUILDER
// ============================================================================

/**
 * Build a CalculatedIndicator from computed values and an indicator definition.
 * Reduces repetitive boilerplate across all calculator functions.
 */
function buildIndicator(
  indicatorId: string,
  values: (number | null)[],
  missingElements: string[] = []
): CalculatedIndicator {
  const indicator = VECTORING_INDICATORS.find(i => i.id === indicatorId)!;
  return {
    indicatorId,
    name: indicator.name,
    values,
    interpretation: values.map(v => interpretThreshold(v, indicator.thresholds).interpretation),
    fertility: values.map(v => interpretThreshold(v, indicator.thresholds).fertility as any),
    missingElements,
    statistics: calculateStats(values)
  };
}

// ============================================================================
// INDICATOR DEFINITIONS
// ============================================================================

export const VECTORING_INDICATORS: VectoringIndicator[] = [
  // -------------------------------------------------------------------------
  // PORPHYRY Cu-Au FERTILITY INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'sr-y',
    name: 'Sr/Y Ratio',
    formula: 'Sr / Y',
    description: 'High Sr/Y indicates suppression of plagioclase fractionation (deep/hydrous magma) - favorable for porphyry Cu-Au',
    category: 'fertility',
    depositTypes: ['porphyry-cu-au', 'porphyry-cu-mo'],
    requiredElements: ['Sr', 'Y'],
    thresholds: [
      { value: 20, operator: '<', interpretation: 'Low fertility - shallow/dry magma', color: '#ef4444', fertility: 'low' },
      { value: 20, upperValue: 40, operator: 'between', interpretation: 'Moderate fertility', color: '#f59e0b', fertility: 'moderate' },
      { value: 40, upperValue: 100, operator: 'between', interpretation: 'High fertility (adakitic)', color: '#22c55e', fertility: 'high' },
      { value: 100, operator: '>', interpretation: 'Very high fertility (highly adakitic)', color: '#15803d', fertility: 'very-high' }
    ],
    references: ['Richards & Kerrich (2007)', 'Loucks (2014)']
  },
  {
    id: 'v-sc',
    name: 'V/Sc Ratio',
    formula: 'V / Sc',
    description: 'High V/Sc indicates oxidized magma - favorable for Cu-Au transport',
    category: 'fertility',
    depositTypes: ['porphyry-cu-au', 'porphyry-cu-mo'],
    requiredElements: ['V', 'Sc'],
    thresholds: [
      { value: 10, operator: '<', interpretation: 'Reduced/unfertile', color: '#ef4444', fertility: 'low' },
      { value: 10, upperValue: 20, operator: 'between', interpretation: 'Moderately oxidized', color: '#f59e0b', fertility: 'moderate' },
      { value: 20, operator: '>', interpretation: 'Oxidized/fertile', color: '#22c55e', fertility: 'high' }
    ],
    references: ['Loucks (2014)']
  },
  {
    id: 'eu-anomaly',
    name: 'Eu/Eu* Anomaly',
    formula: 'Eu_N / sqrt(Sm_N × Gd_N)',
    description: 'Eu/Eu* > 0.8 indicates no plagioclase fractionation - oxidized/fertile',
    category: 'fertility',
    depositTypes: ['porphyry-cu-au', 'vms', 'carbonatite-ree'],
    requiredElements: ['Eu', 'Sm', 'Gd'],
    thresholds: [
      { value: 0.6, operator: '<', interpretation: 'Negative anomaly - evolved/less fertile', color: '#ef4444', fertility: 'low' },
      { value: 0.6, upperValue: 0.8, operator: 'between', interpretation: 'Slight negative anomaly', color: '#f59e0b', fertility: 'moderate' },
      { value: 0.8, upperValue: 1.0, operator: 'between', interpretation: 'No anomaly - oxidized/fertile', color: '#22c55e', fertility: 'high' },
      { value: 1.0, operator: '>', interpretation: 'Positive anomaly', color: '#3b82f6', fertility: 'high' }
    ],
    references: ['Richards & Kerrich (2007)']
  },
  {
    id: 'k-na',
    name: 'K/Na Ratio',
    formula: 'K2O / Na2O (molar)',
    description: 'Indicator of alteration zonation in porphyry systems',
    category: 'alteration',
    depositTypes: ['porphyry-cu-au', 'porphyry-cu-mo', 'orogenic-gold'],
    requiredElements: ['K', 'Na'],
    thresholds: [
      { value: 0.5, operator: '<', interpretation: 'Sodic (propylitic/distal)', color: '#3b82f6', fertility: 'low' },
      { value: 0.5, upperValue: 1.5, operator: 'between', interpretation: 'Transitional', color: '#f59e0b', fertility: 'moderate' },
      { value: 1.5, operator: '>', interpretation: 'Potassic (proximal/ore zone)', color: '#22c55e', fertility: 'high' }
    ]
  },

  // -------------------------------------------------------------------------
  // KOMATIITE Ni INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'ni-cr',
    name: 'Ni/Cr Ratio',
    formula: 'Ni / Cr',
    description: 'High Ni/Cr indicates sulfide-depleted Cr (channelized komatiite)',
    category: 'fertility',
    depositTypes: ['komatiite-ni'],
    requiredElements: ['Ni', 'Cr'],
    thresholds: [
      { value: 0.5, operator: '<', interpretation: 'Barren flow', color: '#ef4444', fertility: 'barren' },
      { value: 0.5, upperValue: 1.0, operator: 'between', interpretation: 'Potentially mineralized', color: '#f59e0b', fertility: 'moderate' },
      { value: 1.0, operator: '>', interpretation: 'Fertile channelized flow', color: '#22c55e', fertility: 'high' }
    ],
    references: ['Lesher et al. (1999)']
  },
  {
    id: 'kambalda-ratio',
    name: 'Kambalda Ratio',
    formula: '(Ni/Cr) × (Cu/Zn)',
    description: 'Combined ratio for identifying channelized komatiite environments',
    category: 'fertility',
    depositTypes: ['komatiite-ni'],
    requiredElements: ['Ni', 'Cr', 'Cu', 'Zn'],
    thresholds: [
      { value: 0.5, operator: '<', interpretation: 'Barren', color: '#ef4444', fertility: 'barren' },
      { value: 0.5, upperValue: 1.0, operator: 'between', interpretation: 'Background', color: '#f59e0b', fertility: 'low' },
      { value: 1.0, operator: '>=', interpretation: 'Potentially fertile channelized flow', color: '#22c55e', fertility: 'high' }
    ],
    references: ['Barnes et al. (2004)']
  },
  {
    id: 'mg-number',
    name: 'Mg# (Magnesium Number)',
    formula: '100 × Mg / (Mg + Fe)',
    description: 'Indicator of fractionation state',
    category: 'fractionation',
    depositTypes: ['komatiite-ni', 'ni-cu-pge-intrusion'],
    requiredElements: ['Mg', 'Fe'],
    thresholds: [
      { value: 50, operator: '<', interpretation: 'Highly fractionated', color: '#3b82f6' },
      { value: 50, upperValue: 70, operator: 'between', interpretation: 'Moderately fractionated', color: '#f59e0b' },
      { value: 70, operator: '>', interpretation: 'Primitive/unfractionated', color: '#22c55e' }
    ]
  },

  // -------------------------------------------------------------------------
  // CARLIN GOLD PATHFINDERS
  // -------------------------------------------------------------------------
  {
    id: 'carlin-as',
    name: 'Arsenic Anomaly',
    formula: 'As (ppm)',
    description: 'Primary pathfinder for Carlin-type gold - halo extends ~2.2 km from ore',
    category: 'pathfinder',
    depositTypes: ['carlin-gold'],
    requiredElements: ['As'],
    thresholds: [
      { value: 20, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 20, upperValue: 100, operator: 'between', interpretation: 'Weakly anomalous', color: '#fcd34d', fertility: 'low' },
      { value: 100, upperValue: 500, operator: 'between', interpretation: 'Anomalous - within halo', color: '#f59e0b', fertility: 'moderate' },
      { value: 500, operator: '>', interpretation: 'Strongly anomalous - proximal', color: '#dc2626', fertility: 'high' }
    ],
    references: ['MDRU Carlin Research (2024)']
  },
  {
    id: 'carlin-sb',
    name: 'Antimony Anomaly',
    formula: 'Sb (ppm)',
    description: 'Secondary pathfinder for Carlin gold',
    category: 'pathfinder',
    depositTypes: ['carlin-gold'],
    requiredElements: ['Sb'],
    thresholds: [
      { value: 1, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 1, upperValue: 5, operator: 'between', interpretation: 'Weakly anomalous', color: '#fcd34d', fertility: 'low' },
      { value: 5, upperValue: 20, operator: 'between', interpretation: 'Anomalous', color: '#f59e0b', fertility: 'moderate' },
      { value: 20, operator: '>', interpretation: 'Strongly anomalous', color: '#dc2626', fertility: 'high' }
    ]
  },
  {
    id: 'carlin-hg',
    name: 'Mercury Anomaly',
    formula: 'Hg (ppm or ppb)',
    description: 'Mercury pathfinder - extends beyond As halo',
    category: 'pathfinder',
    depositTypes: ['carlin-gold'],
    requiredElements: ['Hg'],
    thresholds: [
      { value: 0.1, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 0.1, upperValue: 1, operator: 'between', interpretation: 'Weakly anomalous', color: '#fcd34d', fertility: 'low' },
      { value: 1, operator: '>', interpretation: 'Anomalous', color: '#f59e0b', fertility: 'moderate' }
    ]
  },
  {
    id: 'carlin-tl',
    name: 'Thallium Anomaly',
    formula: 'Tl (ppm)',
    description: 'Thallium pathfinder - proximal indicator',
    category: 'pathfinder',
    depositTypes: ['carlin-gold', 'sedex'],
    requiredElements: ['Tl'],
    thresholds: [
      { value: 1, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 1, upperValue: 5, operator: 'between', interpretation: 'Anomalous', color: '#f59e0b', fertility: 'moderate' },
      { value: 5, operator: '>', interpretation: 'Strongly anomalous - proximal', color: '#dc2626', fertility: 'high' }
    ]
  },

  // -------------------------------------------------------------------------
  // LCT PEGMATITE FRACTIONATION INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'k-rb',
    name: 'K/Rb Ratio',
    formula: 'K / Rb (or K2O × 10000 / Rb)',
    description: 'Key fractionation indicator - decreases with evolved pegmatites',
    category: 'fractionation',
    depositTypes: ['lct-pegmatite'],
    requiredElements: ['K', 'Rb'],
    thresholds: [
      { value: 10, operator: '<', interpretation: 'Cs zone - most evolved', color: '#15803d', fertility: 'very-high' },
      { value: 10, upperValue: 30, operator: 'between', interpretation: 'Li-fertile zone', color: '#22c55e', fertility: 'high' },
      { value: 30, upperValue: 100, operator: 'between', interpretation: 'Approaching Li zone', color: '#f59e0b', fertility: 'moderate' },
      { value: 100, upperValue: 200, operator: 'between', interpretation: 'Moderately fractionated', color: '#94a3b8', fertility: 'low' },
      { value: 200, operator: '>', interpretation: 'Barren/distal', color: '#ef4444', fertility: 'barren' }
    ],
    references: ['Selway et al. (2005)', 'USGS Pegmatite Model']
  },
  {
    id: 'nb-ta',
    name: 'Nb/Ta Ratio',
    formula: 'Nb / Ta',
    description: 'Decreases with fractionation - low values indicate evolved pegmatites',
    category: 'fractionation',
    depositTypes: ['lct-pegmatite'],
    requiredElements: ['Nb', 'Ta'],
    thresholds: [
      { value: 5, operator: '<', interpretation: 'Highly evolved - Ta enriched', color: '#22c55e', fertility: 'high' },
      { value: 5, upperValue: 8, operator: 'between', interpretation: 'Evolved', color: '#f59e0b', fertility: 'moderate' },
      { value: 8, upperValue: 15, operator: 'between', interpretation: 'Moderately fractionated', color: '#94a3b8', fertility: 'low' },
      { value: 15, operator: '>', interpretation: 'Primitive', color: '#ef4444', fertility: 'barren' }
    ]
  },
  {
    id: 'zr-hf',
    name: 'Zr/Hf Ratio',
    formula: 'Zr / Hf',
    description: 'Decreases with fractionation in granitic systems',
    category: 'fractionation',
    depositTypes: ['lct-pegmatite', 'sn-w-greisen'],
    requiredElements: ['Zr', 'Hf'],
    thresholds: [
      { value: 15, operator: '<', interpretation: 'Highly evolved', color: '#22c55e', fertility: 'high' },
      { value: 15, upperValue: 30, operator: 'between', interpretation: 'Evolved', color: '#f59e0b', fertility: 'moderate' },
      { value: 30, operator: '>', interpretation: 'Unfractionated', color: '#94a3b8', fertility: 'low' }
    ]
  },
  {
    id: 'mg-li',
    name: 'Mg/Li Ratio',
    formula: 'Mg / Li',
    description: 'Low Mg/Li indicates Li enrichment',
    category: 'fertility',
    depositTypes: ['lct-pegmatite'],
    requiredElements: ['Mg', 'Li'],
    thresholds: [
      { value: 5, operator: '<', interpretation: 'Li enriched', color: '#22c55e', fertility: 'high' },
      { value: 5, upperValue: 10, operator: 'between', interpretation: 'Moderately Li enriched', color: '#f59e0b', fertility: 'moderate' },
      { value: 10, operator: '>', interpretation: 'Not Li enriched', color: '#94a3b8', fertility: 'low' }
    ]
  },

  // -------------------------------------------------------------------------
  // SEDEX INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'sedex-metal-index',
    name: 'SEDEX Metal Index',
    formula: 'Zn + 100×Pb + 100×Tl',
    description: 'Combined metal index for SEDEX exploration',
    category: 'proximity',
    depositTypes: ['sedex'],
    requiredElements: ['Zn', 'Pb', 'Tl'],
    thresholds: [
      { value: 500, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 500, upperValue: 2000, operator: 'between', interpretation: 'Weakly anomalous', color: '#fcd34d', fertility: 'low' },
      { value: 2000, upperValue: 10000, operator: 'between', interpretation: 'Anomalous', color: '#f59e0b', fertility: 'moderate' },
      { value: 10000, operator: '>', interpretation: 'Strongly anomalous', color: '#dc2626', fertility: 'high' }
    ],
    references: ['Large & McGoldrick (1998)']
  },
  {
    id: 'sedex-alteration-index',
    name: 'SEDEX Alteration Index',
    formula: '(FeO + 10×MnO) × 100 / (FeO + 10×MnO + MgO)',
    description: 'Fe-Mn enrichment relative to Mg',
    category: 'alteration',
    depositTypes: ['sedex'],
    requiredElements: ['Fe', 'Mn', 'Mg'],
    thresholds: [
      { value: 20, operator: '<', interpretation: 'Unaltered', color: '#94a3b8', fertility: 'barren' },
      { value: 20, upperValue: 50, operator: 'between', interpretation: 'Weakly altered', color: '#fcd34d', fertility: 'low' },
      { value: 50, upperValue: 80, operator: 'between', interpretation: 'Altered', color: '#f59e0b', fertility: 'moderate' },
      { value: 80, operator: '>', interpretation: 'Strongly altered', color: '#dc2626', fertility: 'high' }
    ]
  },

  // -------------------------------------------------------------------------
  // URANIUM ROLL-FRONT INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'u-se-relation',
    name: 'Selenium Anomaly',
    formula: 'Se (ppm)',
    description: 'Se marks the redox front position in roll-front U deposits',
    category: 'proximity',
    depositTypes: ['uranium-rollfront'],
    requiredElements: ['Se'],
    thresholds: [
      { value: 1, operator: '<', interpretation: 'Background - oxidized zone', color: '#f59e0b', fertility: 'low' },
      { value: 1, upperValue: 10, operator: 'between', interpretation: 'Elevated - near redox front', color: '#22c55e', fertility: 'high' },
      { value: 10, operator: '>', interpretation: 'Very high - at redox front', color: '#15803d', fertility: 'very-high' }
    ]
  },
  {
    id: 'u-mo-relation',
    name: 'Molybdenum Anomaly',
    formula: 'Mo (ppm)',
    description: 'Mo indicates reduced sediments downdip from U ore',
    category: 'proximity',
    depositTypes: ['uranium-rollfront'],
    requiredElements: ['Mo'],
    thresholds: [
      { value: 2, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'low' },
      { value: 2, upperValue: 10, operator: 'between', interpretation: 'Elevated - reduced zone', color: '#f59e0b', fertility: 'moderate' },
      { value: 10, operator: '>', interpretation: 'High - strongly reduced', color: '#3b82f6', fertility: 'moderate' }
    ]
  },

  // -------------------------------------------------------------------------
  // IRGS (Intrusion-Related Gold) INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'au-bi',
    name: 'Au-Bi Association',
    formula: 'Au/Bi ratio or correlation',
    description: 'Au-Bi association is characteristic of proximal IRGS mineralization',
    category: 'proximity',
    depositTypes: ['irgs'],
    requiredElements: ['Au', 'Bi'],
    thresholds: [
      { value: 0.1, operator: '<', interpretation: 'Bi-dominated (proximal?)', color: '#22c55e', fertility: 'high' },
      { value: 0.1, upperValue: 1, operator: 'between', interpretation: 'Balanced Au-Bi', color: '#f59e0b', fertility: 'moderate' },
      { value: 1, operator: '>', interpretation: 'Au-dominated', color: '#94a3b8', fertility: 'low' }
    ]
  },
  {
    id: 'bi-te-signature',
    name: 'Bi-Te Signature',
    formula: 'Bi + Te (normalized)',
    description: 'Bi-Te enrichment indicates IRGS metal assemblage',
    category: 'pathfinder',
    depositTypes: ['irgs'],
    requiredElements: ['Bi', 'Te'],
    thresholds: [
      { value: 1, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 1, upperValue: 10, operator: 'between', interpretation: 'Weakly anomalous', color: '#fcd34d', fertility: 'low' },
      { value: 10, operator: '>', interpretation: 'IRGS signature present', color: '#22c55e', fertility: 'high' }
    ]
  },

  // -------------------------------------------------------------------------
  // OROGENIC GOLD INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'au-ag',
    name: 'Au:Ag Ratio',
    formula: 'Au / Ag',
    description: 'High Au:Ag (>5:1) indicates orogenic signature',
    category: 'fertility',
    depositTypes: ['orogenic-gold'],
    requiredElements: ['Au', 'Ag'],
    thresholds: [
      { value: 1, operator: '<', interpretation: 'Epithermal signature', color: '#3b82f6', fertility: 'low' },
      { value: 1, upperValue: 5, operator: 'between', interpretation: 'Mixed signature', color: '#f59e0b', fertility: 'moderate' },
      { value: 5, operator: '>', interpretation: 'Orogenic signature', color: '#22c55e', fertility: 'high' }
    ]
  },
  {
    id: 'three-k-al',
    name: '3K/Al Molar Ratio',
    formula: '3 × (K2O/94.2) / (Al2O3/101.96)',
    description: 'Sericite saturation indicator - 0.33 = complete sericite saturation',
    category: 'alteration',
    depositTypes: ['orogenic-gold', 'porphyry-cu-au'],
    requiredElements: ['K', 'Al'],
    thresholds: [
      { value: 0.1, operator: '<', interpretation: 'Low K - propylitic/unaltered', color: '#94a3b8', fertility: 'low' },
      { value: 0.1, upperValue: 0.25, operator: 'between', interpretation: 'Moderate sericite', color: '#f59e0b', fertility: 'moderate' },
      { value: 0.25, upperValue: 0.4, operator: 'between', interpretation: 'Near sericite saturation', color: '#22c55e', fertility: 'high' },
      { value: 0.4, operator: '>', interpretation: 'Above saturation - K-feldspar present', color: '#3b82f6', fertility: 'moderate' }
    ]
  },

  // -------------------------------------------------------------------------
  // IOCG INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'na-al',
    name: 'Na/Al Molar Ratio',
    formula: 'Na2O_mol / Al2O3_mol',
    description: 'Sodic alteration indicator',
    category: 'alteration',
    depositTypes: ['iocg'],
    requiredElements: ['Na', 'Al'],
    thresholds: [
      { value: 0.3, operator: '<', interpretation: 'K-dominant (prospective)', color: '#22c55e', fertility: 'high' },
      { value: 0.3, upperValue: 0.6, operator: 'between', interpretation: 'Mixed', color: '#f59e0b', fertility: 'moderate' },
      { value: 0.6, operator: '>', interpretation: 'Na-dominant (often barren)', color: '#ef4444', fertility: 'low' }
    ]
  },
  {
    id: 'co-ni',
    name: 'Co/Ni Ratio',
    formula: 'Co / Ni',
    description: 'High Co/Ni indicates IOCG signature',
    category: 'fertility',
    depositTypes: ['iocg'],
    requiredElements: ['Co', 'Ni'],
    thresholds: [
      { value: 0.1, operator: '<', interpretation: 'Ni-dominant (not IOCG)', color: '#94a3b8', fertility: 'low' },
      { value: 0.1, upperValue: 0.5, operator: 'between', interpretation: 'Transitional', color: '#f59e0b', fertility: 'moderate' },
      { value: 0.5, operator: '>', interpretation: 'Co-enriched (IOCG signature)', color: '#22c55e', fertility: 'high' }
    ]
  },

  // -------------------------------------------------------------------------
  // Ni-Cu-PGE INTRUSION INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'pd-cu',
    name: 'Pd/Cu Ratio',
    formula: 'Pd (ppb) / Cu (ppm)',
    description: 'Sulfide depletion indicator - low values indicate S-saturation',
    category: 'fertility',
    depositTypes: ['ni-cu-pge-intrusion'],
    requiredElements: ['Pd', 'Cu'],
    thresholds: [
      { value: 0.1, operator: '<', interpretation: 'Undepleted - no prior S-saturation', color: '#ef4444', fertility: 'low' },
      { value: 0.1, upperValue: 1, operator: 'between', interpretation: 'Moderately depleted', color: '#f59e0b', fertility: 'moderate' },
      { value: 1, operator: '>', interpretation: 'Depleted - prior S-saturation (ore nearby)', color: '#22c55e', fertility: 'high' }
    ]
  },
  {
    id: 'th-yb',
    name: 'Th/Yb Ratio',
    formula: 'Th / Yb',
    description: 'Crustal contamination indicator',
    category: 'fertility',
    depositTypes: ['ni-cu-pge-intrusion', 'komatiite-ni'],
    requiredElements: ['Th', 'Yb'],
    thresholds: [
      { value: 0.5, operator: '<', interpretation: 'Mantle signature (uncontaminated)', color: '#94a3b8', fertility: 'low' },
      { value: 0.5, upperValue: 2, operator: 'between', interpretation: 'Minor contamination', color: '#f59e0b', fertility: 'moderate' },
      { value: 2, operator: '>', interpretation: 'Significant contamination (S-source)', color: '#22c55e', fertility: 'high' }
    ]
  },

  // -------------------------------------------------------------------------
  // VMS INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'ba-sr',
    name: 'Ba/Sr Ratio',
    formula: 'Ba / Sr',
    description: 'Increases away from VMS vent',
    category: 'proximity',
    depositTypes: ['vms'],
    requiredElements: ['Ba', 'Sr'],
    thresholds: [
      { value: 1, operator: '<', interpretation: 'Proximal to vent', color: '#22c55e', fertility: 'high' },
      { value: 1, upperValue: 5, operator: 'between', interpretation: 'Intermediate', color: '#f59e0b', fertility: 'moderate' },
      { value: 5, operator: '>', interpretation: 'Distal from vent', color: '#94a3b8', fertility: 'low' }
    ]
  },
  {
    id: 'alteration-index',
    name: 'Ishikawa Alteration Index',
    formula: '100 × (K2O + MgO) / (K2O + MgO + Na2O + CaO)',
    description: 'Alteration intensity for VMS/porphyry systems',
    category: 'alteration',
    depositTypes: ['vms', 'porphyry-cu-au'],
    requiredElements: ['K', 'Mg', 'Na', 'Ca'],
    thresholds: [
      { value: 35, operator: '<', interpretation: 'Least altered', color: '#94a3b8', fertility: 'low' },
      { value: 35, upperValue: 65, operator: 'between', interpretation: 'Moderately altered', color: '#f59e0b', fertility: 'moderate' },
      { value: 65, operator: '>', interpretation: 'Intensely altered', color: '#22c55e', fertility: 'high' }
    ]
  },
  {
    id: 'ccpi',
    name: 'CCPI (Chlorite-Carbonate-Pyrite Index)',
    formula: '100 × (MgO + FeO) / (MgO + FeO + Na2O + K2O)',
    description: 'Chlorite alteration index',
    category: 'alteration',
    depositTypes: ['vms'],
    requiredElements: ['Mg', 'Fe', 'Na', 'K'],
    thresholds: [
      { value: 50, operator: '<', interpretation: 'Low CCPI - sericitic', color: '#fcd34d' },
      { value: 50, upperValue: 75, operator: 'between', interpretation: 'Moderate CCPI', color: '#f59e0b' },
      { value: 75, operator: '>', interpretation: 'High CCPI - chloritic', color: '#22c55e' }
    ]
  },

  // -------------------------------------------------------------------------
  // Sn-W GREISEN INDICATORS
  // -------------------------------------------------------------------------
  {
    id: 'sn-content',
    name: 'Tin Content',
    formula: 'Sn (ppm)',
    description: 'Direct tin content indicator',
    category: 'pathfinder',
    depositTypes: ['sn-w-greisen'],
    requiredElements: ['Sn'],
    thresholds: [
      { value: 5, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 5, upperValue: 50, operator: 'between', interpretation: 'Anomalous', color: '#f59e0b', fertility: 'moderate' },
      { value: 50, upperValue: 500, operator: 'between', interpretation: 'Strongly anomalous', color: '#22c55e', fertility: 'high' },
      { value: 500, operator: '>', interpretation: 'Ore grade', color: '#15803d', fertility: 'very-high' }
    ]
  },
  {
    id: 'w-content',
    name: 'Tungsten Content',
    formula: 'W (ppm)',
    description: 'Direct tungsten content indicator',
    category: 'pathfinder',
    depositTypes: ['sn-w-greisen'],
    requiredElements: ['W'],
    thresholds: [
      { value: 2, operator: '<', interpretation: 'Background', color: '#94a3b8', fertility: 'barren' },
      { value: 2, upperValue: 20, operator: 'between', interpretation: 'Anomalous', color: '#f59e0b', fertility: 'moderate' },
      { value: 20, upperValue: 200, operator: 'between', interpretation: 'Strongly anomalous', color: '#22c55e', fertility: 'high' },
      { value: 200, operator: '>', interpretation: 'Ore grade', color: '#15803d', fertility: 'very-high' }
    ]
  },
];

// ============================================================================
// DEPOSIT CONFIGURATIONS
// ============================================================================

export const DEPOSIT_CONFIGS: DepositConfig[] = [
  {
    type: 'porphyry-cu-au',
    name: 'Porphyry Cu-Au',
    description: 'Porphyry copper-gold deposits associated with calc-alkaline to alkaline intrusions',
    indicators: ['sr-y', 'v-sc', 'eu-anomaly', 'k-na', 'alteration-index', 'three-k-al'],
    pathfinderSuite: ['Cu', 'Au', 'Mo', 'Ag', 'As'],
    keyRatios: ['Sr/Y', 'V/Sc', 'Eu/Eu*', 'K/Na'],
    alteration: ['Potassic', 'Phyllic', 'Propylitic', 'Argillic'],
    references: ['Richards & Kerrich (2007)', 'Loucks (2014)']
  },
  {
    type: 'komatiite-ni',
    name: 'Komatiite-hosted Ni Sulfide',
    description: 'Nickel sulfide deposits in channelized komatiite flows',
    indicators: ['ni-cr', 'kambalda-ratio', 'mg-number', 'th-yb'],
    pathfinderSuite: ['Ni', 'Cu', 'Co', 'PGE', 'Cr'],
    keyRatios: ['Ni/Cr', '(Ni/Cr)x(Cu/Zn)', 'Mg#'],
    references: ['Barnes et al. (2004)', 'Lesher et al. (1999)']
  },
  {
    type: 'carlin-gold',
    name: 'Carlin-type Gold',
    description: 'Sediment-hosted, disseminated gold deposits with characteristic As-Sb-Hg-Tl signature',
    indicators: ['carlin-as', 'carlin-sb', 'carlin-hg', 'carlin-tl'],
    pathfinderSuite: ['Au', 'As', 'Sb', 'Hg', 'Tl'],
    keyRatios: [],
    references: ['MDRU Carlin Research', 'Cortez Hills Study']
  },
  {
    type: 'irgs',
    name: 'Intrusion-Related Gold (IRGS)',
    description: 'Reduced intrusion-related gold systems with Au-Bi-Te-W signature',
    indicators: ['au-bi', 'bi-te-signature'],
    pathfinderSuite: ['Au', 'Bi', 'Te', 'W', 'As', 'Sb', 'Mo', 'Sn'],
    keyRatios: ['Au/Bi', 'Bi/Te'],
    references: ['Hart (2007)', 'Thompson et al. (1999)']
  },
  {
    type: 'lct-pegmatite',
    name: 'LCT Pegmatite',
    description: 'Lithium-cesium-tantalum pegmatites - critical mineral sources',
    indicators: ['k-rb', 'nb-ta', 'zr-hf', 'mg-li'],
    pathfinderSuite: ['Li', 'Cs', 'Ta', 'Rb', 'Nb', 'Be', 'Sn'],
    keyRatios: ['K/Rb', 'Nb/Ta', 'Zr/Hf', 'Mg/Li'],
    references: ['USGS LCT Pegmatite Model', 'Selway et al. (2005)']
  },
  {
    type: 'sedex',
    name: 'SEDEX Zn-Pb-Ag',
    description: 'Sedimentary exhalative zinc-lead-silver deposits',
    indicators: ['sedex-metal-index', 'sedex-alteration-index', 'carlin-tl'],
    pathfinderSuite: ['Zn', 'Pb', 'Ag', 'Tl', 'Mn', 'Ba', 'Fe'],
    keyRatios: ['SEDEX Metal Index', 'SEDEX AI'],
    references: ['Large & McGoldrick (1998)']
  },
  {
    type: 'uranium-rollfront',
    name: 'Uranium Roll-Front',
    description: 'Sandstone-hosted roll-front uranium deposits',
    indicators: ['u-se-relation', 'u-mo-relation'],
    pathfinderSuite: ['U', 'Se', 'Mo', 'V', 'As'],
    keyRatios: ['U/Se position', 'Se/Mo zonation'],
    references: ['Harshman (1974)', 'USGS Uranium Studies']
  },
  {
    type: 'orogenic-gold',
    name: 'Orogenic Gold',
    description: 'Structure-hosted orogenic gold deposits',
    indicators: ['au-ag', 'three-k-al', 'carlin-as', 'carlin-sb'],
    pathfinderSuite: ['Au', 'As', 'Sb', 'W', 'Bi', 'Te', 'Ag'],
    keyRatios: ['Au:Ag', '3K/Al'],
    references: ['Goldfarb et al. (2005)']
  },
  {
    type: 'vms',
    name: 'VMS (Volcanogenic Massive Sulfide)',
    description: 'Volcanic-hosted massive sulfide deposits',
    indicators: ['eu-anomaly', 'ba-sr', 'alteration-index', 'ccpi'],
    pathfinderSuite: ['Cu', 'Zn', 'Pb', 'Au', 'Ag', 'Ba'],
    keyRatios: ['Ba/Sr', 'Eu/Eu*', 'AI', 'CCPI'],
    alteration: ['Chlorite', 'Sericite', 'Silicification'],
    references: ['Large et al. (2001)']
  },
  {
    type: 'iocg',
    name: 'IOCG (Iron Oxide Copper-Gold)',
    description: 'Iron oxide copper-gold deposits',
    indicators: ['na-al', 'k-na', 'co-ni'],
    pathfinderSuite: ['Cu', 'Au', 'U', 'REE', 'Co', 'Fe'],
    keyRatios: ['Na/Al', 'K/Al', 'Co/Ni'],
    alteration: ['Sodic', 'Potassic', 'Iron oxide'],
    references: ['Williams et al. (2005)']
  },
  {
    type: 'ni-cu-pge-intrusion',
    name: 'Intrusion-hosted Ni-Cu-PGE',
    description: 'Magmatic nickel-copper-PGE sulfide deposits in mafic-ultramafic intrusions',
    indicators: ['pd-cu', 'th-yb', 'mg-number'],
    pathfinderSuite: ['Ni', 'Cu', 'Pt', 'Pd', 'Co', 'Cr'],
    keyRatios: ['Pd/Cu', 'Th/Yb', 'La/Sm', 'Mg#'],
    references: ['Naldrett (2004)']
  },
  {
    type: 'sn-w-greisen',
    name: 'Sn-W Greisen',
    description: 'Tin-tungsten greisen and vein deposits',
    indicators: ['sn-content', 'w-content', 'k-rb', 'zr-hf'],
    pathfinderSuite: ['Sn', 'W', 'Li', 'F', 'Rb', 'Cs', 'As', 'Bi'],
    keyRatios: ['K/Rb', 'Zr/Hf'],
    alteration: ['Greisen', 'Silicification', 'Topazification'],
    references: ['USGS Sn-W Model']
  },
  {
    type: 'porphyry-cu-mo',
    name: 'Porphyry Cu-Mo',
    description: 'Porphyry copper-molybdenum deposits in calc-alkaline arc settings',
    indicators: ['sr-y', 'v-sc', 'eu-anomaly', 'k-na', 'alteration-index'],
    pathfinderSuite: ['Cu', 'Mo', 'Ag', 'Re', 'As'],
    keyRatios: ['Sr/Y', 'V/Sc', 'Mo/Cu'],
    alteration: ['Potassic', 'Phyllic', 'Propylitic'],
    references: ['Sillitoe (2010)']
  },
  {
    type: 'epithermal-hs',
    name: 'Epithermal High-Sulfidation',
    description: 'High-sulfidation epithermal Au-Cu deposits with advanced argillic alteration',
    indicators: ['alteration-index', 'k-na', 'carlin-as'],
    pathfinderSuite: ['Au', 'Cu', 'As', 'Sb', 'Bi', 'Te', 'Sn'],
    keyRatios: ['Au/Ag', 'Bi/As', 'Cu/Au'],
    alteration: ['Vuggy silica', 'Advanced argillic', 'Argillic'],
    references: ['Hedenquist et al. (2000)']
  },
  {
    type: 'epithermal-ls',
    name: 'Epithermal Low-Sulfidation',
    description: 'Low-sulfidation epithermal Au-Ag deposits with adularia-sericite alteration',
    indicators: ['au-ag', 'k-na', 'carlin-hg', 'carlin-sb'],
    pathfinderSuite: ['Au', 'Ag', 'Hg', 'Sb', 'As', 'Se', 'Tl'],
    keyRatios: ['Au/Ag', 'K/Rb', 'Hg anomaly'],
    alteration: ['Adularia-sericite', 'Propylitic', 'Silicification'],
    references: ['Simmons et al. (2005)']
  },
  {
    type: 'skarn',
    name: 'Skarn Deposits',
    description: 'Contact metasomatic deposits in carbonate rocks adjacent to intrusions',
    indicators: ['alteration-index', 'k-na', 'eu-anomaly'],
    pathfinderSuite: ['W', 'Mo', 'Cu', 'Zn', 'Pb', 'Sn', 'Au'],
    keyRatios: ['Fe/Mg', 'Mn/Fe', 'W/Mo'],
    alteration: ['Prograde skarn', 'Retrograde skarn', 'Hornfels'],
    references: ['Meinert et al. (2005)']
  },
  {
    type: 'mvt',
    name: 'MVT (Mississippi Valley-Type)',
    description: 'Carbonate-hosted Zn-Pb deposits in platform settings',
    indicators: ['carlin-tl', 'sedex-alteration-index'],
    pathfinderSuite: ['Zn', 'Pb', 'Cd', 'Ge', 'Ga', 'Tl', 'Fe'],
    keyRatios: ['Zn/Pb', 'Fe/Mn', 'Tl anomaly'],
    references: ['Leach et al. (2005)']
  },
  {
    type: 'carbonatite-ree',
    name: 'Carbonatite-REE',
    description: 'REE-Nb-P deposits associated with carbonatite and alkaline complexes',
    indicators: ['eu-anomaly', 'nb-ta'],
    pathfinderSuite: ['La', 'Ce', 'Nd', 'Nb', 'P', 'Sr', 'Ba', 'Th', 'U'],
    keyRatios: ['LREE/HREE', 'Nb/Ta', 'La/Yb', 'Eu/Eu*'],
    references: ['Verplanck et al. (2016)']
  },
];

// ============================================================================
// CALCULATOR REGISTRY
// ============================================================================

type CalculatorFn = (
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
) => CalculatedIndicator | null;

/**
 * Specialized calculator functions for complex indicators.
 * Simple ratio and single-element indicators are handled by generic calculators.
 */
const CALCULATOR_REGISTRY: Record<string, CalculatorFn> = {
  'eu-anomaly': calculateEuAnomaly,
  'kambalda-ratio': calculateKambaldaRatio,
  'sedex-metal-index': calculateSEDEXMetalIndex,
  'sedex-alteration-index': calculateSEDEXAlterationIndex,
  'three-k-al': calculate3KAl,
  'alteration-index': calculateAlterationIndex,
  'ccpi': calculateCCPI,
  'mg-number': calculateMgNumber,
  'bi-te-signature': calculateBiTeSignature,
  'k-rb': calculateKRb,
};

// ============================================================================
// SPECIALIZED CALCULATOR FUNCTIONS
// ============================================================================

function calculateEuAnomaly(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const euCol = findElementColumn(columns, 'Eu', geochemMappings);
  const smCol = findElementColumn(columns, 'Sm', geochemMappings);
  const gdCol = findElementColumn(columns, 'Gd', geochemMappings);

  if (!euCol || !smCol || !gdCol) return null;

  const values: (number | null)[] = data.map(row => {
    const eu = Number(row[euCol]);
    const sm = Number(row[smCol]);
    const gd = Number(row[gdCol]);

    if (isNaN(eu) || isNaN(sm) || isNaN(gd) || sm <= 0 || gd <= 0) return null;

    const euN = eu / CHONDRITE_VALUES.Eu;
    const smN = sm / CHONDRITE_VALUES.Sm;
    const gdN = gd / CHONDRITE_VALUES.Gd;

    return euN / Math.sqrt(smN * gdN);
  });

  return buildIndicator('eu-anomaly', values);
}

function calculateKambaldaRatio(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const niCol = findElementColumn(columns, 'Ni', geochemMappings);
  const crCol = findElementColumn(columns, 'Cr', geochemMappings);
  const cuCol = findElementColumn(columns, 'Cu', geochemMappings);
  const znCol = findElementColumn(columns, 'Zn', geochemMappings);

  if (!niCol || !crCol || !cuCol || !znCol) return null;

  const values: (number | null)[] = data.map(row => {
    const ni = Number(row[niCol]);
    const cr = Number(row[crCol]);
    const cu = Number(row[cuCol]);
    const zn = Number(row[znCol]);

    if (isNaN(ni) || isNaN(cr) || isNaN(cu) || isNaN(zn) || cr === 0 || zn === 0) return null;

    return (ni / cr) * (cu / zn);
  });

  return buildIndicator('kambalda-ratio', values);
}

function calculateSEDEXMetalIndex(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const znCol = findElementColumn(columns, 'Zn', geochemMappings);
  const pbCol = findElementColumn(columns, 'Pb', geochemMappings);
  const tlCol = findElementColumn(columns, 'Tl', geochemMappings);

  if (!znCol || !pbCol) return null;

  const values: (number | null)[] = data.map(row => {
    const zn = Number(row[znCol]);
    const pb = Number(row[pbCol]);
    const tl = tlCol ? Number(row[tlCol]) : 0;

    if (isNaN(zn) || isNaN(pb)) return null;

    return zn + 100 * pb + 100 * (isNaN(tl) ? 0 : tl);
  });

  return buildIndicator('sedex-metal-index', values, tlCol ? [] : ['Tl']);
}

function calculateAlterationIndex(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const kCol = findElementColumn(columns, 'K', geochemMappings);
  const mgCol = findElementColumn(columns, 'Mg', geochemMappings);
  const naCol = findElementColumn(columns, 'Na', geochemMappings);
  const caCol = findElementColumn(columns, 'Ca', geochemMappings);

  if (!kCol || !mgCol || !naCol || !caCol) return null;

  const values: (number | null)[] = data.map(row => {
    const k = Number(row[kCol]);
    const mg = Number(row[mgCol]);
    const na = Number(row[naCol]);
    const ca = Number(row[caCol]);

    if (isNaN(k) || isNaN(mg) || isNaN(na) || isNaN(ca)) return null;
    const denom = k + mg + na + ca;
    if (denom === 0) return null;

    return 100 * (k + mg) / denom;
  });

  return buildIndicator('alteration-index', values);
}

function calculateCCPI(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const mgCol = findElementColumn(columns, 'Mg', geochemMappings);
  const feCol = findElementColumn(columns, 'Fe', geochemMappings);
  const naCol = findElementColumn(columns, 'Na', geochemMappings);
  const kCol = findElementColumn(columns, 'K', geochemMappings);

  if (!mgCol || !feCol || !naCol || !kCol) return null;

  const values: (number | null)[] = data.map(row => {
    const mg = Number(row[mgCol]);
    const fe = Number(row[feCol]);
    const na = Number(row[naCol]);
    const k = Number(row[kCol]);

    if (isNaN(mg) || isNaN(fe) || isNaN(na) || isNaN(k)) return null;
    const denom = mg + fe + na + k;
    if (denom === 0) return null;

    return 100 * (mg + fe) / denom;
  });

  return buildIndicator('ccpi', values);
}

function calculateSEDEXAlterationIndex(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const feCol = findElementColumn(columns, 'Fe', geochemMappings);
  const mnCol = findElementColumn(columns, 'Mn', geochemMappings);
  const mgCol = findElementColumn(columns, 'Mg', geochemMappings);

  if (!feCol || !mnCol || !mgCol) return null;

  const values: (number | null)[] = data.map(row => {
    const fe = Number(row[feCol]);
    const mn = Number(row[mnCol]);
    const mg = Number(row[mgCol]);

    if (isNaN(fe) || isNaN(mn) || isNaN(mg)) return null;
    const feMnTerm = fe + 10 * mn;
    const denom = feMnTerm + mg;
    if (denom === 0) return null;

    return 100 * feMnTerm / denom;
  });

  return buildIndicator('sedex-alteration-index', values);
}

function calculateMgNumber(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const mgCol = findElementColumn(columns, 'Mg', geochemMappings);
  const feCol = findElementColumn(columns, 'Fe', geochemMappings);

  if (!mgCol || !feCol) return null;

  const values: (number | null)[] = data.map(row => {
    const mg = Number(row[mgCol]);
    const fe = Number(row[feCol]);

    if (isNaN(mg) || isNaN(fe)) return null;
    const denom = mg + fe;
    if (denom === 0) return null;

    return 100 * mg / denom;
  });

  return buildIndicator('mg-number', values);
}

function calculateBiTeSignature(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const biCol = findElementColumn(columns, 'Bi', geochemMappings);
  const teCol = findElementColumn(columns, 'Te', geochemMappings);

  if (!biCol || !teCol) return null;

  const values: (number | null)[] = data.map(row => {
    const bi = Number(row[biCol]);
    const te = Number(row[teCol]);

    if (isNaN(bi) || isNaN(te)) return null;

    return bi + te;
  });

  return buildIndicator('bi-te-signature', values);
}

function calculateKRb(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const kCol = findElementColumn(columns, 'K', geochemMappings);
  const rbCol = findElementColumn(columns, 'Rb', geochemMappings);

  if (!kCol || !rbCol) return null;

  const values: (number | null)[] = data.map(row => {
    const k = Number(row[kCol]);
    const rb = Number(row[rbCol]);

    if (isNaN(k) || isNaN(rb) || rb === 0) return null;

    return (k * 10000) / rb;
  });

  return buildIndicator('k-rb', values);
}

function calculate3KAl(
  data: Record<string, any>[],
  columns: string[],
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const kCol = findElementColumn(columns, 'K', geochemMappings);
  const alCol = findElementColumn(columns, 'Al', geochemMappings);

  if (!kCol || !alCol) return null;

  const values: (number | null)[] = data.map(row => {
    const k = Number(row[kCol]);
    const al = Number(row[alCol]);

    if (isNaN(k) || isNaN(al) || al === 0) return null;

    return 3 * (k / 94.2) / (al / 101.96);
  });

  return buildIndicator('three-k-al', values);
}

/**
 * Calculate a generic ratio indicator (2 elements)
 */
function calculateRatioIndicator(
  data: Record<string, any>[],
  columns: string[],
  indicatorId: string,
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const indicator = VECTORING_INDICATORS.find(i => i.id === indicatorId);
  if (!indicator || indicator.requiredElements.length !== 2) return null;

  const numCol = findElementColumn(columns, indicator.requiredElements[0], geochemMappings);
  const denCol = findElementColumn(columns, indicator.requiredElements[1], geochemMappings);

  if (!numCol || !denCol) return null;

  const values = calculateRatio(data, numCol, denCol);
  return buildIndicator(indicatorId, values);
}

/**
 * Calculate a single-element indicator (pathfinder)
 */
function calculateElementIndicator(
  data: Record<string, any>[],
  columns: string[],
  indicatorId: string,
  geochemMappings?: ColumnGeochemMapping[]
): CalculatedIndicator | null {
  const indicator = VECTORING_INDICATORS.find(i => i.id === indicatorId);
  if (!indicator) return null;

  const col = findElementColumn(columns, indicator.requiredElements[0], geochemMappings);
  if (!col) return null;

  const values = getColumnValues(data, col);
  return buildIndicator(indicatorId, values);
}

// ============================================================================
// MAIN CALCULATION FUNCTION
// ============================================================================

/**
 * Main vectoring calculation for a deposit type
 */
export function calculateVectoring(
  data: Record<string, any>[],
  columns: string[],
  depositType: DepositType,
  geochemMappings?: ColumnGeochemMapping[]
): VectoringResult {
  const config = DEPOSIT_CONFIGS.find(c => c.type === depositType);
  if (!config) {
    throw new Error(`Unknown deposit type: ${depositType}`);
  }

  const indicators: CalculatedIndicator[] = [];
  const missingIndicators: MissingIndicatorInfo[] = [];
  const allRequiredElements = new Set<string>();
  const foundElements = new Set<string>();
  const missingElements = new Set<string>();

  // Calculate each indicator for this deposit type
  for (const indicatorId of config.indicators) {
    const indicatorDef = VECTORING_INDICATORS.find(i => i.id === indicatorId);
    if (!indicatorDef) continue;

    // Track all required elements
    for (const el of indicatorDef.requiredElements) {
      allRequiredElements.add(el);
    }

    let result: CalculatedIndicator | null = null;

    // Use registry for specialized calculators, fall back to generic
    const specializedCalc = CALCULATOR_REGISTRY[indicatorId];
    if (specializedCalc) {
      result = specializedCalc(data, columns, geochemMappings);
    } else if (indicatorDef.requiredElements.length === 2) {
      result = calculateRatioIndicator(data, columns, indicatorId, geochemMappings);
    } else if (indicatorDef.requiredElements.length === 1) {
      result = calculateElementIndicator(data, columns, indicatorId, geochemMappings);
    }

    if (result) {
      indicators.push(result);
      // Mark found elements
      for (const el of indicatorDef.requiredElements) {
        foundElements.add(el);
      }
    } else {
      // Track which elements are missing for this indicator
      const missing = indicatorDef.requiredElements.filter(
        el => !findElementColumn(columns, el, geochemMappings)
      );
      missingIndicators.push({
        indicatorId,
        name: indicatorDef.name,
        missingElements: missing,
      });
      for (const el of missing) {
        missingElements.add(el);
      }
    }
  }

  // Build element availability summary
  const elementAvailability = {
    found: Array.from(foundElements).sort(),
    missing: Array.from(missingElements).sort(),
  };

  // Calculate type-specific summary results
  const result: VectoringResult = {
    depositType,
    timestamp: new Date(),
    sampleCount: data.length,
    indicators,
    missingIndicators,
    elementAvailability,
    summary: generateSummary(indicators, missingIndicators, depositType, elementAvailability)
  };

  // Add type-specific results
  if (depositType === 'porphyry-cu-au' || depositType === 'porphyry-cu-mo') {
    result.porphyryResult = generatePorphyryResult(indicators);
  } else if (depositType === 'komatiite-ni') {
    result.komatiiteResult = generateKomatiiteResult(indicators);
  } else if (depositType === 'carlin-gold') {
    result.carlinResult = generateCarlinResult(indicators);
  } else if (depositType === 'lct-pegmatite') {
    result.lctResult = generateLCTResult(indicators);
  }

  return result;
}

// ============================================================================
// DATA-DRIVEN SUMMARY GENERATION
// ============================================================================

function generateSummary(
  indicators: CalculatedIndicator[],
  missingIndicators: MissingIndicatorInfo[],
  depositType: DepositType,
  _elementAvailability: { found: string[]; missing: string[] }
): { overallAssessment: string; keyFindings: string[]; recommendations: string[] } {
  const findings: string[] = [];
  const recommendations: string[] = [];
  const config = DEPOSIT_CONFIGS.find(c => c.type === depositType);

  // Analyze each indicator
  const positiveIndicatorNames: string[] = [];
  for (const ind of indicators) {
    const stats = ind.statistics;
    if (stats.validCount === 0) continue;

    const highFertility = ind.fertility.filter(f => f === 'high' || f === 'very-high').length;
    const pctHigh = (highFertility / stats.validCount) * 100;

    if (pctHigh > 30) {
      findings.push(`${ind.name}: ${pctHigh.toFixed(0)}% of samples show high fertility/prospectivity`);
      positiveIndicatorNames.push(ind.name);
    } else if (pctHigh > 10) {
      findings.push(`${ind.name}: ${pctHigh.toFixed(0)}% of samples show elevated values`);
      positiveIndicatorNames.push(ind.name);
    }
  }

  // Data-driven recommendations
  if (positiveIndicatorNames.length >= 2) {
    recommendations.push(
      `Samples with coincident positive ${positiveIndicatorNames.slice(0, 3).join(' AND ')} are highest priority targets`
    );
  }

  if (positiveIndicatorNames.length >= 1 && config) {
    const ratioNames = config.keyRatios.slice(0, 2).join(', ');
    if (ratioNames) {
      recommendations.push(`Map spatial distribution of ${ratioNames} to identify zonation trends`);
    }
  }

  // Recommendations for missing data
  if (missingIndicators.length > 0) {
    const uniqueMissing = [...new Set(missingIndicators.flatMap(m => m.missingElements))];
    const skippedNames = missingIndicators.map(m => m.name).join(', ');
    recommendations.push(
      `Add ${uniqueMissing.join(', ')} analysis to enable ${skippedNames}`
    );
  }

  // Alteration-specific recommendation if applicable
  if (config?.alteration && config.alteration.length > 0) {
    const hasAlterationIndicator = indicators.some(i =>
      i.indicatorId.includes('alteration') || i.indicatorId === 'ccpi' || i.indicatorId === 'k-na'
    );
    if (hasAlterationIndicator) {
      recommendations.push(`Assess ${config.alteration[0]} alteration intensity in prospective zones`);
    }
  }

  // Low prospectivity - suggest alternatives
  const positiveIndicators = indicators.filter(ind =>
    ind.fertility.filter(f => f === 'high' || f === 'very-high').length > ind.statistics.validCount * 0.1
  ).length;

  if (positiveIndicators === 0 && indicators.length > 0) {
    recommendations.push(
      `Low prospectivity for ${config?.name || depositType} - consider running comparison against other deposit types`
    );
  }

  // Overall assessment
  let overallAssessment = 'Low prospectivity';
  if (indicators.length === 0) {
    overallAssessment = 'Unable to assess - insufficient element data';
  } else if (positiveIndicators >= 3) {
    overallAssessment = 'High prospectivity - multiple positive indicators';
  } else if (positiveIndicators >= 2) {
    overallAssessment = 'Moderate prospectivity - some positive indicators';
  } else if (positiveIndicators >= 1) {
    overallAssessment = 'Weak prospectivity - limited positive indicators';
  }

  return {
    overallAssessment,
    keyFindings: findings.length > 0 ? findings : ['No significant anomalies detected'],
    recommendations
  };
}

// ============================================================================
// TYPE-SPECIFIC RESULT GENERATORS
// ============================================================================

function generatePorphyryResult(indicators: CalculatedIndicator[]): PorphyryFertilityResult {
  const srY = indicators.find(i => i.indicatorId === 'sr-y') || null;
  const vSc = indicators.find(i => i.indicatorId === 'v-sc') || null;
  const euAnomaly = indicators.find(i => i.indicatorId === 'eu-anomaly') || null;
  const kNa = indicators.find(i => i.indicatorId === 'k-na') || null;

  let score = 0;
  let count = 0;

  const addScore = (ind: CalculatedIndicator | null) => {
    if (!ind) return;
    const high = ind.fertility.filter(f => f === 'high' || f === 'very-high').length;
    const mod = ind.fertility.filter(f => f === 'moderate').length;
    const total = ind.statistics.validCount;
    if (total > 0) {
      score += (high * 100 + mod * 50) / total;
      count++;
    }
  };

  addScore(srY);
  addScore(vSc);
  addScore(euAnomaly);

  const avgScore = count > 0 ? score / count : 0;

  let overallFertility: 'barren' | 'low' | 'moderate' | 'high' | 'very-high' = 'low';
  if (avgScore > 75) overallFertility = 'very-high';
  else if (avgScore > 50) overallFertility = 'high';
  else if (avgScore > 25) overallFertility = 'moderate';

  return {
    srY,
    vSc,
    euAnomaly,
    kNa,
    ceAnomaly: null,
    dyYb: null,
    overallFertility,
    fertilityScore: avgScore
  };
}

function generateKomatiiteResult(indicators: CalculatedIndicator[]): KomatiiteNiResult {
  const niCr = indicators.find(i => i.indicatorId === 'ni-cr') || null;
  const kambaldaRatio = indicators.find(i => i.indicatorId === 'kambalda-ratio') || null;
  const mgNumber = indicators.find(i => i.indicatorId === 'mg-number') || null;

  const channelPotential = kambaldaRatio
    ? kambaldaRatio.fertility.filter(f => f === 'high').length > kambaldaRatio.statistics.validCount * 0.1
    : false;

  const highFertility = [niCr, kambaldaRatio].filter(i =>
    i && i.fertility.filter(f => f === 'high').length > i.statistics.validCount * 0.1
  ).length;

  return {
    niCr,
    cuZn: null,
    kambaldaRatio,
    mgNumber,
    fertility: highFertility >= 2 ? 'high' : highFertility >= 1 ? 'moderate' : 'low',
    channelPotential
  };
}

function generateCarlinResult(indicators: CalculatedIndicator[]): CarlinGoldResult {
  const asAnomalies = indicators.find(i => i.indicatorId === 'carlin-as') || null;
  const sbAnomalies = indicators.find(i => i.indicatorId === 'carlin-sb') || null;
  const hgAnomalies = indicators.find(i => i.indicatorId === 'carlin-hg') || null;
  const tlAnomalies = indicators.find(i => i.indicatorId === 'carlin-tl') || null;

  let pathfinderScore = 0;
  [asAnomalies, sbAnomalies, hgAnomalies, tlAnomalies].forEach(ind => {
    if (!ind) return;
    const high = ind.fertility.filter(f => f === 'high').length;
    const total = ind.statistics.validCount;
    if (total > 0) pathfinderScore += (high / total) * 25;
  });

  let distanceToOre: 'distal' | 'intermediate' | 'proximal' = 'distal';
  if (tlAnomalies && tlAnomalies.fertility.filter(f => f === 'high').length > 0) {
    distanceToOre = 'proximal';
  } else if (asAnomalies && asAnomalies.fertility.filter(f => f === 'high' || f === 'moderate').length > 0) {
    distanceToOre = 'intermediate';
  }

  return {
    asAnomalies,
    sbAnomalies,
    hgAnomalies,
    tlAnomalies,
    pathfinderScore,
    distanceToOre
  };
}

function generateLCTResult(indicators: CalculatedIndicator[]): LCTPegmatiteResult {
  const kRb = indicators.find(i => i.indicatorId === 'k-rb') || null;
  const nbTa = indicators.find(i => i.indicatorId === 'nb-ta') || null;
  const zrHf = indicators.find(i => i.indicatorId === 'zr-hf') || null;
  const mgLi = indicators.find(i => i.indicatorId === 'mg-li') || null;

  let fractionationDegree: 'primitive' | 'moderate' | 'evolved' | 'highly-evolved' = 'primitive';
  if (kRb) {
    const median = kRb.statistics.median;
    if (median < 15) fractionationDegree = 'highly-evolved';
    else if (median < 50) fractionationDegree = 'evolved';
    else if (median < 150) fractionationDegree = 'moderate';
  }

  const assessPotential = (ind: CalculatedIndicator | null): 'barren' | 'low' | 'moderate' | 'high' => {
    if (!ind) return 'barren';
    const high = ind.fertility.filter(f => f === 'high' || f === 'very-high').length;
    const pct = high / ind.statistics.validCount;
    if (pct > 0.3) return 'high';
    if (pct > 0.1) return 'moderate';
    if (pct > 0) return 'low';
    return 'barren';
  };

  return {
    kRb,
    nbTa,
    zrHf,
    mgLi,
    csContent: null,
    fractionationDegree,
    liPotential: assessPotential(mgLi) !== 'barren' ? assessPotential(mgLi) : assessPotential(kRb),
    csPotential: fractionationDegree === 'highly-evolved' ? 'high' : 'low',
    taPotential: assessPotential(nbTa)
  };
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

export function getIndicatorsForDeposit(depositType: DepositType): VectoringIndicator[] {
  const config = DEPOSIT_CONFIGS.find(c => c.type === depositType);
  if (!config) return [];

  return VECTORING_INDICATORS.filter(i => config.indicators.includes(i.id));
}

export function getAllDepositTypes(): DepositConfig[] {
  return DEPOSIT_CONFIGS;
}

export function getDepositConfig(depositType: DepositType): DepositConfig | undefined {
  return DEPOSIT_CONFIGS.find(c => c.type === depositType);
}
