/**
 * Element Name Normalizer Utility
 *
 * Normalizes element column names (e.g., "K_pct", "Ba_ppm", "Fe2O3")
 * to standard element symbols for pattern matching.
 */

import { ElementMapping, ColumnGeochemMapping, GeochemCategory } from '../../types/associations';

// ============================================================================
// GEOCHEMICAL CATEGORY CONSTANTS
// ============================================================================

/**
 * Elements typically reported as major oxides in whole-rock geochemistry
 */
export const MAJOR_OXIDE_ELEMENTS = new Set([
  'Si', 'Al', 'Fe', 'Mg', 'Ca', 'Na', 'K', 'Ti', 'P', 'Mn', 'Cr'
]);

/**
 * Rare Earth Elements (lanthanides)
 */
export const REE_ELEMENTS = new Set([
  'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd',
  'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'
]);

/**
 * Reverse mapping: element symbol -> list of known oxide formulas
 */
export const ELEMENT_TO_OXIDES: Record<string, string[]> = {
  Si: ['SiO2'],
  Al: ['Al2O3'],
  Fe: ['Fe2O3', 'FeO', 'Fe2O3T', 'FeOT'],
  Mg: ['MgO'],
  Ca: ['CaO'],
  Na: ['Na2O'],
  K: ['K2O'],
  Ti: ['TiO2'],
  P: ['P2O5'],
  Mn: ['MnO'],
  Cr: ['Cr2O3'],
  Ni: ['NiO'],
  Ba: ['BaO'],
  Sr: ['SrO'],
  Zr: ['ZrO2'],
  V: ['V2O5'],
  S: ['SO3'],
  C: ['CO2'],
  H: ['H2O'],
};

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
export const OXIDE_MAPPINGS: Record<string, string | null> = {
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
  'LOI': 'LOI',  // Loss on ignition - treated as major oxide analytical component
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
  'Total', 'TOTAL', 'Sum', 'SUM',
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
export function detectUnit(columnName: string): string | null {
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
export function stripUnitSuffixes(columnName: string): string {
  let result = columnName.trim();

  // Strip common trailing non-unit modifiers first (e.g., _d, _dup, _rep, _orig)
  // This ensures unit suffixes like _pct can be found when followed by modifiers
  result = result.replace(/[_](?:d|dup|rep|orig|std|raw|avg|mean|med|final)$/i, '');

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
export function extractElementFromOxide(name: string): string | null {
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

  // Check for LOI (Loss on Ignition) — important analytical component
  const loiPattern = /^(LOI|loi|Loss|LOSS|Loss[\s_]?on[\s_]?Ignition)$/i;
  const strippedForLoi = stripUnitSuffixes(original);
  if (loiPattern.test(strippedForLoi)) {
    return {
      originalName: original,
      detectedElement: 'LOI',
      confidence: 'high',
      detectedUnit: detectUnit(original) || 'pct',
      isExcluded: false,
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
 * Regex patterns that identify non-element columns by name.
 * Uses substring or prefix matching to catch variants like NorthUTM, EastUTM, DepthFrom, etc.
 */
const NON_ELEMENT_PATTERNS = [
  // Coordinates & spatial (catches NorthUTM, EastUTM, RLUTM, Easting_m, NorthingGDA, etc.)
  /north/i,
  /east/i,
  /south/i,
  /west/i,
  /utm/i,
  /coord/i,
  /elev/i,
  /^rl/i,          // RL, RLUTM, RL_m etc.
  /latit/i,
  /longi/i,
  /^lat$/i,
  /^lon$/i,
  /^long$/i,
  // Depth & interval
  /depth/i,
  /^from$/i,
  /^to$/i,
  /interval/i,
  // IDs & labels
  /sample/i,
  /^id$/i,
  /hole/i,
  /dhid/i,
  // Weights & physical
  /^wt/i,
  /weight/i,
  /moisture/i,
  /recovery/i,
  /^rqd$/i,
  // Metadata
  /^unnamed/i,
  /^original/i,
  /^date$/i,
  /^time$/i,
  /lith/i,
  /descript/i,
  /comment/i,
  /^notes?$/i,
  /^zone$/i,
  /^block$/i,
  /^unit$/i,
  // Totals & aggregates
  /^total$/i,
  /^sum$/i,
];

/**
 * Determine if a column is a non-element column (coordinates, depth, weights, etc.)
 * These should be excluded from bulk PCA selection but can still be manually selected.
 */
export function isNonElementColumn(columnName: string, role: string | null): boolean {
  // 1. Column has a backend-assigned role (East, North, Elevation, From, To, ID, HoleID, etc.)
  if (role) return true;

  const trimmed = columnName.trim();

  // 2. Column name is in the EXCLUDED_NAMES set (exact match)
  if (EXCLUDED_NAMES.has(trimmed) || EXCLUDED_NAMES.has(trimmed.toUpperCase())) return true;

  // 3. Pattern-based exclusions (substring/prefix matching for coordinate variants etc.)
  for (const pattern of NON_ELEMENT_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // 4. Final fallback using normalizeElementName confidence.
  //    'high' = direct element symbol match (Au_ppm, Cu_pct) → real element
  //    'medium' = oxide formula match (Fe2O3, SiO2) → real element
  //    'low' = only first 1-2 chars matched a symbol (ALOH_wtmica → "Al") → not a real element column
  //    'unknown' = nothing matched → not an element
  const mapping = normalizeElementName(trimmed);
  if (mapping.confidence === 'unknown' || mapping.confidence === 'low') return true;

  return false;
}

/**
 * Quick function to detect element symbol from a column name
 * Returns the element symbol or null if not detected
 */
export function detectElementFromColumnName(columnName: string): string | null {
  const mapping = normalizeElementName(columnName);
  return mapping.userOverride ?? mapping.detectedElement;
}

// ============================================================================
// GEOCHEM MAPPING ENGINE
// ============================================================================

/**
 * Determine if a stripped column name is an oxide formula
 */
function isOxideFormula(strippedName: string): boolean {
  // LOI is in OXIDE_MAPPINGS but is not itself an oxide formula
  if (strippedName.toUpperCase() === 'LOI') return false;

  const upper = strippedName.toUpperCase();
  for (const oxide of Object.keys(OXIDE_MAPPINGS)) {
    if (upper === oxide.toUpperCase()) return true;
  }
  // Generic oxide pattern: Element + numbers + O + numbers
  return /^[A-Z][a-z]?\d*O\d*$/.test(strippedName);
}

/**
 * Get the oxide formula string from a stripped column name
 */
function getOxideFormula(strippedName: string): string | null {
  // Check direct oxide mappings (case-insensitive match, return canonical form)
  for (const oxide of Object.keys(OXIDE_MAPPINGS)) {
    if (strippedName.toUpperCase() === oxide.toUpperCase()) return oxide;
  }
  // If it matches the generic oxide pattern, return as-is
  if (/^[A-Z][a-z]?\d*O\d*$/.test(strippedName)) return strippedName;
  return null;
}

/**
 * Determine the GeochemCategory for a column mapping
 */
function categorizeMapping(
  element: string | null,
  isOxide: boolean,
  unit: string | null,
  isExcluded: boolean,
  role: string | null
): GeochemCategory {
  // Non-geochemical: excluded or has a structural role
  if (isExcluded || role) return 'nonGeochemical';

  // No element detected
  if (!element) return 'unknown';

  // LOI (Loss on Ignition) — always categorized with major oxides
  if (element === 'LOI') return 'majorOxide';

  // REE check
  if (REE_ELEMENTS.has(element)) return 'ree';

  // Major oxide: reported as oxide form, or element is in MAJOR_OXIDE_ELEMENTS with pct unit
  if (isOxide) return 'majorOxide';
  if (MAJOR_OXIDE_ELEMENTS.has(element) && unit === 'pct') return 'majorOxide';

  // If element detected but not above categories -> trace element
  return 'traceElement';
}

/**
 * Interface matching ColumnInfo from appStore
 */
interface ColumnInfoLike {
  name: string;
  role?: string | null;
}

/**
 * Create geochemistry-aware mappings for an array of column names.
 * Extends the basic ElementMapping with oxide/unit/category metadata.
 */
export function createGeochemMappings(
  columnNames: string[],
  columnInfos?: ColumnInfoLike[]
): ColumnGeochemMapping[] {
  const infoMap = new Map<string, ColumnInfoLike>();
  if (columnInfos) {
    for (const info of columnInfos) {
      infoMap.set(info.name, info);
    }
  }

  return columnNames.map(name => {
    const baseMapping = normalizeElementName(name);
    const info = infoMap.get(name);
    const role = info?.role ?? null;

    // Strip unit to get the core name for oxide detection
    const stripped = stripUnitSuffixes(name.trim());
    let isOxide = isOxideFormula(stripped);
    let oxideFormula = isOxide ? getOxideFormula(stripped) : null;

    // Use base mapping's detected element
    const element = baseMapping.userOverride ?? baseMapping.detectedElement;
    const unit = baseMapping.detectedUnit;

    // Secondary oxide inference: if element is known but oxide wasn't detected,
    // check if the column name contains a known oxide pattern for that element
    if (!oxideFormula && element) {
      const knownOxides = ELEMENT_TO_OXIDES[element];
      if (knownOxides) {
        const lowerName = name.toLowerCase();
        for (const ox of knownOxides) {
          if (lowerName.includes(ox.toLowerCase())) {
            oxideFormula = ox;
            isOxide = true;
            break;
          }
        }
      }
    }

    // Determine if excluded (either from normalizer or via role)
    const isExcluded = baseMapping.isExcluded || isNonElementColumn(name, role);

    const category = categorizeMapping(element, isOxide, unit, isExcluded, role);

    return {
      ...baseMapping,
      isExcluded,
      isOxide,
      oxideFormula,
      userUnit: null,
      category,
      isConfirmed: false,
      role,
    };
  });
}

// ============================================================================
// QUERY / SELECTOR FUNCTIONS
// ============================================================================

/**
 * Find column by oxide formula (e.g., "SiO2" -> "SiO2_pct")
 */
export function findColumnForOxide(
  mappings: ColumnGeochemMapping[],
  oxideFormula: string
): string | null {
  const upper = oxideFormula.toUpperCase();
  const match = mappings.find(
    m => !m.isExcluded && m.oxideFormula?.toUpperCase() === upper
  );
  return match?.originalName ?? null;
}

/**
 * Find column by element symbol, optionally filtered by unit
 */
export function findColumnForElement(
  mappings: ColumnGeochemMapping[],
  element: string,
  unit?: string
): string | null {
  const match = mappings.find(m => {
    if (m.isExcluded) return false;
    const el = m.userOverride ?? m.detectedElement;
    if (el !== element) return false;
    if (unit) {
      const effectiveUnit = m.userUnit ?? m.detectedUnit;
      return effectiveUnit === unit;
    }
    return true;
  });
  return match?.originalName ?? null;
}

/**
 * Get all columns in a specific category
 */
export function getColumnsByCategory(
  mappings: ColumnGeochemMapping[],
  category: GeochemCategory
): ColumnGeochemMapping[] {
  return mappings.filter(m => m.category === category);
}

/**
 * Get trace element column names
 */
export function getTraceElementColumns(mappings: ColumnGeochemMapping[]): string[] {
  return mappings
    .filter(m => m.category === 'traceElement' && !m.isExcluded)
    .map(m => m.originalName);
}

/**
 * Get major oxide column names
 */
export function getMajorOxideColumns(mappings: ColumnGeochemMapping[]): string[] {
  return mappings
    .filter(m => m.category === 'majorOxide' && !m.isExcluded)
    .map(m => m.originalName);
}

/**
 * Get REE column names
 */
export function getREEColumns(mappings: ColumnGeochemMapping[]): string[] {
  return mappings
    .filter(m => m.category === 'ree' && !m.isExcluded)
    .map(m => m.originalName);
}

export default {
  normalizeElementName,
  createElementMappings,
  createGeochemMappings,
  buildMappingMap,
  getMappingSummary,
  getUniqueElements,
  autoFillMappings,
  detectElementFromColumnName,
  isNonElementColumn,
  findColumnForOxide,
  findColumnForElement,
  getColumnsByCategory,
  getTraceElementColumns,
  getMajorOxideColumns,
  getREEColumns,
  PERIODIC_TABLE_SYMBOLS,
  MAJOR_OXIDE_ELEMENTS,
  REE_ELEMENTS,
  OXIDE_MAPPINGS,
  ELEMENT_TO_OXIDES,
};
