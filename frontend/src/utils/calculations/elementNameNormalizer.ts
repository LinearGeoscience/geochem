/**
 * Element Name Normalizer Utility
 *
 * Normalizes element column names (e.g., "K_pct", "Ba_ppm", "Fe2O3")
 * to standard element symbols for pattern matching.
 */

import { ElementMapping } from '../../types/associations';

// ============================================================================
// PERIODIC TABLE DATA
// ============================================================================

/**
 * All valid element symbols from the periodic table
 */
export const PERIODIC_TABLE_SYMBOLS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
  'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
  'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
  'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
  'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
  'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og'
]);

/**
 * Common oxide formulae and their corresponding element
 */
const OXIDE_MAPPINGS: Record<string, string | null> = {
  // Major oxides
  'SiO2': 'Si',
  'Al2O3': 'Al',
  'Fe2O3': 'Fe',
  'FeO': 'Fe',
  'Fe2O3T': 'Fe',
  'FeOT': 'Fe',
  'MgO': 'Mg',
  'CaO': 'Ca',
  'Na2O': 'Na',
  'K2O': 'K',
  'TiO2': 'Ti',
  'P2O5': 'P',
  'MnO': 'Mn',
  'Cr2O3': 'Cr',
  'NiO': 'Ni',
  'BaO': 'Ba',
  'SrO': 'Sr',
  'ZrO2': 'Zr',
  'V2O5': 'V',
  'SO3': 'S',
  'CO2': 'C',
  'H2O': 'H',
  'LOI': null,  // Loss on ignition - excluded
};

/**
 * Unit suffixes to strip from column names
 */
const UNIT_SUFFIXES = [
  '_ppm', '_ppb', '_pct', '_percent', '_wt%', '_wt', '_%',
  ' ppm', ' ppb', ' pct', ' percent', ' wt%', ' wt', ' %',
  '(ppm)', '(ppb)', '(pct)', '(percent)', '(wt%)', '(wt)', '(%)',
  '_PPM', '_PPB', '_PCT', '_PERCENT', '_WT%', '_WT', '_%',
  ' PPM', ' PPB', ' PCT', ' PERCENT', ' WT%', ' WT',
];

/**
 * Names to exclude from element mapping (not element data)
 */
const EXCLUDED_NAMES = new Set([
  'LOI', 'loi', 'LOSS', 'Loss', 'Total', 'TOTAL', 'Sum', 'SUM',
  'Sample', 'SAMPLE', 'SampleID', 'Sample_ID', 'ID', 'id',
  'Easting', 'EASTING', 'Northing', 'NORTHING', 'East', 'North',
  'X', 'Y', 'Z', 'Elevation', 'ELEVATION', 'Depth', 'DEPTH',
  'Lat', 'Lon', 'Latitude', 'Longitude', 'LAT', 'LON',
  'Date', 'DATE', 'Time', 'TIME', 'LITH', 'Lith', 'Lithology',
  'Description', 'DESC', 'Notes', 'NOTES', 'Comment', 'COMMENT',
  'Unit', 'UNIT', 'Zone', 'ZONE', 'Block', 'BLOCK',
  'Hole', 'HOLE', 'HoleID', 'Hole_ID', 'HOLEID',
  'From', 'FROM', 'To', 'TO', 'Interval', 'INTERVAL',
  'Recovery', 'RECOVERY', 'RQD', 'Moisture', 'MOISTURE',
]);

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Detect unit suffix from column name
 */
function detectUnit(columnName: string): string | null {
  const lowerName = columnName.toLowerCase();

  if (lowerName.includes('ppm') || lowerName.includes('ppb')) {
    return lowerName.includes('ppb') ? 'ppb' : 'ppm';
  }
  if (lowerName.includes('pct') || lowerName.includes('percent') || lowerName.includes('wt') || lowerName.includes('%')) {
    return 'pct';
  }
  return null;
}

/**
 * Strip unit suffixes from column name
 */
function stripUnitSuffixes(columnName: string): string {
  let result = columnName.trim();

  for (const suffix of UNIT_SUFFIXES) {
    if (result.toLowerCase().endsWith(suffix.toLowerCase())) {
      result = result.slice(0, -suffix.length).trim();
      break;
    }
  }

  // Also handle trailing underscores or spaces
  return result.replace(/[_\s]+$/, '');
}

/**
 * Check if a string is a valid element symbol
 */
function isValidElement(symbol: string): boolean {
  return PERIODIC_TABLE_SYMBOLS.has(symbol);
}

/**
 * Try to extract element from an oxide formula
 */
function extractElementFromOxide(name: string): string | null {
  // Check direct oxide mappings
  const upperName = name.toUpperCase();
  for (const [oxide, element] of Object.entries(OXIDE_MAPPINGS)) {
    if (upperName === oxide.toUpperCase()) {
      return element;
    }
  }

  // Try to extract element from oxide pattern (e.g., CaO, MgO)
  // Match pattern: Element symbol followed by optional numbers and O
  const oxidePattern = /^([A-Z][a-z]?)(\d*)O(\d*)$/;
  const match = name.match(oxidePattern);
  if (match) {
    const potentialElement = match[1];
    if (isValidElement(potentialElement)) {
      return potentialElement;
    }
  }

  return null;
}

/**
 * Normalize a single element column name to standard element symbol
 */
export function normalizeElementName(columnName: string): ElementMapping {
  const original = columnName.trim();

  // Check for excluded names
  if (EXCLUDED_NAMES.has(original) || EXCLUDED_NAMES.has(original.toUpperCase())) {
    return {
      originalName: original,
      detectedElement: null,
      confidence: 'unknown',
      detectedUnit: null,
      isExcluded: true,
    };
  }

  // Detect unit
  const detectedUnit = detectUnit(original);

  // Strip unit suffixes
  const stripped = stripUnitSuffixes(original);

  // Case 1: Direct element symbol match (exact)
  if (isValidElement(stripped)) {
    return {
      originalName: original,
      detectedElement: stripped,
      confidence: 'high',
      detectedUnit,
      isExcluded: false,
    };
  }

  // Case 2: Check for case-insensitive match (e.g., "fe" -> "Fe")
  const titleCase = stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
  if (isValidElement(titleCase)) {
    return {
      originalName: original,
      detectedElement: titleCase,
      confidence: 'high',
      detectedUnit,
      isExcluded: false,
    };
  }

  // Case 3: Oxide formula
  const oxideElement = extractElementFromOxide(stripped);
  if (oxideElement) {
    return {
      originalName: original,
      detectedElement: oxideElement,
      confidence: 'medium',
      detectedUnit: 'pct', // Oxides are typically in %
      isExcluded: false,
    };
  }

  // Case 4: Try first 1-2 characters as element
  const first2 = stripped.substring(0, 2);
  const titleCase2 = first2.charAt(0).toUpperCase() + first2.charAt(1)?.toLowerCase() || '';
  if (isValidElement(titleCase2)) {
    return {
      originalName: original,
      detectedElement: titleCase2,
      confidence: 'low',
      detectedUnit,
      isExcluded: false,
    };
  }

  // Try just first character
  const first1 = stripped.charAt(0).toUpperCase();
  if (isValidElement(first1)) {
    return {
      originalName: original,
      detectedElement: first1,
      confidence: 'low',
      detectedUnit,
      isExcluded: false,
    };
  }

  // Case 5: Unknown - no element detected
  return {
    originalName: original,
    detectedElement: null,
    confidence: 'unknown',
    detectedUnit,
    isExcluded: false,
  };
}

/**
 * Create element mappings for an array of column names
 */
export function createElementMappings(columnNames: string[]): ElementMapping[] {
  return columnNames.map(name => normalizeElementName(name));
}

/**
 * Build a Map from original column name to element symbol
 * Uses userOverride if present, otherwise detectedElement
 */
export function buildMappingMap(mappings: ElementMapping[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const mapping of mappings) {
    if (mapping.isExcluded) continue;

    const element = mapping.userOverride ?? mapping.detectedElement;
    if (element) {
      map.set(mapping.originalName, element);
    }
  }

  return map;
}

/**
 * Get summary statistics for a set of mappings
 */
export function getMappingSummary(mappings: ElementMapping[]): {
  total: number;
  high: number;
  medium: number;
  low: number;
  unknown: number;
  excluded: number;
  hasIssues: boolean;
} {
  let high = 0, medium = 0, low = 0, unknown = 0, excluded = 0;

  for (const m of mappings) {
    if (m.isExcluded) {
      excluded++;
    } else {
      switch (m.confidence) {
        case 'high': high++; break;
        case 'medium': medium++; break;
        case 'low': low++; break;
        case 'unknown': unknown++; break;
      }
    }
  }

  return {
    total: mappings.length,
    high,
    medium,
    low,
    unknown,
    excluded,
    hasIssues: low > 0 || unknown > 0,
  };
}

/**
 * Get all unique elements detected from mappings
 */
export function getUniqueElements(mappings: ElementMapping[]): string[] {
  const elements = new Set<string>();

  for (const m of mappings) {
    const element = m.userOverride ?? m.detectedElement;
    if (element && !m.isExcluded) {
      elements.add(element);
    }
  }

  return Array.from(elements).sort();
}

/**
 * Auto-populate user overrides with best guesses for low/unknown mappings
 * Returns a new array of mappings with userOverride filled in where possible
 */
export function autoFillMappings(mappings: ElementMapping[]): ElementMapping[] {
  return mappings.map(m => {
    // Only auto-fill for non-excluded, low/unknown confidence entries
    if (m.isExcluded || m.confidence === 'high' || m.confidence === 'medium') {
      return m;
    }

    // If we have a detected element with low confidence, use it
    if (m.detectedElement) {
      return {
        ...m,
        userOverride: m.detectedElement,
      };
    }

    return m;
  });
}

/**
 * Quick function to detect element symbol from a column name
 * Returns the element symbol or null if not detected
 */
export function detectElementFromColumnName(columnName: string): string | null {
  const mapping = normalizeElementName(columnName);
  return mapping.userOverride ?? mapping.detectedElement;
}

export default {
  normalizeElementName,
  createElementMappings,
  buildMappingMap,
  getMappingSummary,
  getUniqueElements,
  autoFillMappings,
  detectElementFromColumnName,
  PERIODIC_TABLE_SYMBOLS,
};
