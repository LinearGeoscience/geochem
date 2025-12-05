/**
 * Type definitions for Deposit-Specific Geochemical Vectoring
 * Based on extensive research on multiple deposit types
 */

// ============================================================================
// DEPOSIT TYPE ENUMS
// ============================================================================

export type DepositType =
  | 'porphyry-cu-au'
  | 'porphyry-cu-mo'
  | 'orogenic-gold'
  | 'carlin-gold'
  | 'irgs'
  | 'epithermal-hs'
  | 'epithermal-ls'
  | 'vms'
  | 'iocg'
  | 'ni-cu-pge-intrusion'
  | 'komatiite-ni'
  | 'lct-pegmatite'
  | 'sn-w-greisen'
  | 'carbonatite-ree'
  | 'skarn'
  | 'sedex'
  | 'mvt'
  | 'uranium-rollfront';

export type VectoringCategory =
  | 'fertility'
  | 'proximity'
  | 'alteration'
  | 'fractionation'
  | 'redox'
  | 'thermal'
  | 'pathfinder';

// ============================================================================
// VECTORING INDICATOR INTERFACES
// ============================================================================

export interface VectoringIndicator {
  id: string;
  name: string;
  formula: string;
  description: string;
  category: VectoringCategory;
  depositTypes: DepositType[];
  requiredElements: string[];
  optionalElements?: string[];
  thresholds: IndicatorThreshold[];
  references?: string[];
}

export interface IndicatorThreshold {
  value: number;
  operator: '<' | '<=' | '>' | '>=' | '==' | 'between';
  upperValue?: number; // For 'between' operator
  interpretation: string;
  color: string; // For visualization
  fertility?: 'barren' | 'low' | 'moderate' | 'high' | 'very-high';
}

export interface CalculatedIndicator {
  indicatorId: string;
  name: string;
  values: (number | null)[];
  interpretation: string[];
  fertility: ('barren' | 'low' | 'moderate' | 'high' | 'very-high' | null)[];
  missingElements: string[];
  statistics: {
    min: number;
    max: number;
    mean: number;
    median: number;
    std: number;
    count: number;
    validCount: number;
  };
}

// ============================================================================
// DEPOSIT-SPECIFIC CONFIGURATIONS
// ============================================================================

export interface DepositConfig {
  type: DepositType;
  name: string;
  description: string;
  indicators: string[]; // IDs of applicable indicators
  pathfinderSuite: string[];
  keyRatios: string[];
  alteration?: string[];
  references: string[];
}

// ============================================================================
// PORPHYRY Cu-Au-Mo SPECIFIC
// ============================================================================

export interface PorphyryFertilityResult {
  srY: CalculatedIndicator | null;
  vSc: CalculatedIndicator | null;
  euAnomaly: CalculatedIndicator | null;
  kNa: CalculatedIndicator | null;
  ceAnomaly: CalculatedIndicator | null;
  dyYb: CalculatedIndicator | null;
  overallFertility: 'barren' | 'low' | 'moderate' | 'high' | 'very-high';
  fertilityScore: number; // 0-100
}

// ============================================================================
// KOMATIITE Ni SPECIFIC
// ============================================================================

export interface KomatiiteNiResult {
  niCr: CalculatedIndicator | null;
  cuZn: CalculatedIndicator | null;
  kambaldaRatio: CalculatedIndicator | null; // (Ni/Cr) × (Cu/Zn)
  mgNumber: CalculatedIndicator | null;
  fertility: 'barren' | 'low' | 'moderate' | 'high';
  channelPotential: boolean;
}

// ============================================================================
// CARLIN GOLD SPECIFIC
// ============================================================================

export interface CarlinGoldResult {
  asAnomalies: CalculatedIndicator | null;
  sbAnomalies: CalculatedIndicator | null;
  hgAnomalies: CalculatedIndicator | null;
  tlAnomalies: CalculatedIndicator | null;
  pathfinderScore: number; // Combined score
  distanceToOre: 'distal' | 'intermediate' | 'proximal';
  vectorDirection?: string;
}

// ============================================================================
// IRGS (Intrusion-Related Gold) SPECIFIC
// ============================================================================

export interface IRGSResult {
  auBi: CalculatedIndicator | null;
  auW: CalculatedIndicator | null;
  auAs: CalculatedIndicator | null;
  biTe: CalculatedIndicator | null;
  zonation: 'proximal' | 'medial' | 'distal';
  metalAssemblage: string;
}

// ============================================================================
// LCT PEGMATITE SPECIFIC
// ============================================================================

export interface LCTPegmatiteResult {
  kRb: CalculatedIndicator | null;
  nbTa: CalculatedIndicator | null;
  zrHf: CalculatedIndicator | null;
  mgLi: CalculatedIndicator | null;
  csContent: CalculatedIndicator | null;
  fractionationDegree: 'primitive' | 'moderate' | 'evolved' | 'highly-evolved';
  liPotential: 'barren' | 'low' | 'moderate' | 'high';
  csPotential: 'barren' | 'low' | 'moderate' | 'high';
  taPotential: 'barren' | 'low' | 'moderate' | 'high';
}

// ============================================================================
// SEDEX SPECIFIC
// ============================================================================

export interface SEDEXResult {
  sedexMetalIndex: CalculatedIndicator | null; // Zn + 100Pb + 100Tl
  sedexAlterationIndex: CalculatedIndicator | null; // (FeO + 10MnO)×100/(FeO + 10MnO + MgO)
  mnDolomite: CalculatedIndicator | null;
  tlHalo: CalculatedIndicator | null;
  proximity: 'distal' | 'intermediate' | 'proximal';
}

// ============================================================================
// URANIUM ROLL-FRONT SPECIFIC
// ============================================================================

export interface UraniumRollFrontResult {
  seAnomaly: CalculatedIndicator | null;
  moAnomaly: CalculatedIndicator | null;
  vAnomaly: CalculatedIndicator | null;
  uSeRelation: 'oxidized' | 'ore-zone' | 'reduced';
  rollFrontPosition: 'updip' | 'at-front' | 'downdip';
}

// ============================================================================
// VMS SPECIFIC
// ============================================================================

export interface VMSResult {
  euAnomaly: CalculatedIndicator | null;
  baSr: CalculatedIndicator | null;
  mnContent: CalculatedIndicator | null;
  alterationIndex: CalculatedIndicator | null;
  ccpi: CalculatedIndicator | null;
  proximity: 'distal' | 'intermediate' | 'proximal' | 'at-vent';
}

// ============================================================================
// TIN-TUNGSTEN GREISEN SPECIFIC
// ============================================================================

export interface SnWGreisenResult {
  snContent: CalculatedIndicator | null;
  wContent: CalculatedIndicator | null;
  liF: CalculatedIndicator | null;
  rbContent: CalculatedIndicator | null;
  zonation: 'outer-halo' | 'intermediate' | 'greisen-proximal' | 'ore-zone';
  metalSignature: string;
}

// ============================================================================
// OROGENIC GOLD SPECIFIC
// ============================================================================

export interface OrogenicGoldResult {
  auAg: CalculatedIndicator | null;
  asAnomaly: CalculatedIndicator | null;
  sbAnomaly: CalculatedIndicator | null;
  wAnomaly: CalculatedIndicator | null;
  biTeSignature: CalculatedIndicator | null;
  threeKAl: CalculatedIndicator | null; // Sericite saturation
  depositStyle: 'orogenic' | 'epithermal' | 'mixed';
}

// ============================================================================
// IOCG SPECIFIC
// ============================================================================

export interface IOCGResult {
  naAl: CalculatedIndicator | null;
  kAl: CalculatedIndicator | null;
  coNi: CalculatedIndicator | null;
  uReeF: CalculatedIndicator | null;
  alterationType: 'sodic' | 'potassic' | 'mixed';
  prospectivity: 'barren' | 'low' | 'moderate' | 'high';
}

// ============================================================================
// Ni-Cu-PGE INTRUSION SPECIFIC
// ============================================================================

export interface NiCuPGEResult {
  pdCu: CalculatedIndicator | null;
  pdTi: CalculatedIndicator | null;
  thYb: CalculatedIndicator | null;
  laSm: CalculatedIndicator | null;
  zrY: CalculatedIndicator | null;
  sulfideDepletion: boolean;
  crustalContamination: 'none' | 'minor' | 'moderate' | 'significant';
}

// ============================================================================
// COMPREHENSIVE VECTORING RESULT
// ============================================================================

export interface VectoringResult {
  depositType: DepositType;
  timestamp: Date;
  sampleCount: number;
  indicators: CalculatedIndicator[];
  summary: {
    overallAssessment: string;
    keyFindings: string[];
    recommendations: string[];
  };

  // Type-specific results
  porphyryResult?: PorphyryFertilityResult;
  komatiiteResult?: KomatiiteNiResult;
  carlinResult?: CarlinGoldResult;
  irgsResult?: IRGSResult;
  lctResult?: LCTPegmatiteResult;
  sedexResult?: SEDEXResult;
  uraniumResult?: UraniumRollFrontResult;
  vmsResult?: VMSResult;
  snwResult?: SnWGreisenResult;
  orogenicResult?: OrogenicGoldResult;
  iocgResult?: IOCGResult;
  nicupgeResult?: NiCuPGEResult;
}

// ============================================================================
// UI STATE TYPES
// ============================================================================

export interface VectoringUIState {
  selectedDepositType: DepositType | null;
  selectedIndicators: string[];
  showAdvancedOptions: boolean;
  isProcessing: boolean;
  error: string | null;
  results: VectoringResult | null;
}

// ============================================================================
// ELEMENT MAPPING FOR COMMON COLUMN NAME VARIATIONS
// ============================================================================

export interface ElementMapping {
  standardName: string;
  aliases: string[];
  unit?: string;
}

export const ELEMENT_MAPPINGS: ElementMapping[] = [
  { standardName: 'Au', aliases: ['Au', 'Au_ppm', 'Au_ppb', 'GOLD', 'Gold'] },
  { standardName: 'Ag', aliases: ['Ag', 'Ag_ppm', 'SILVER', 'Silver'] },
  { standardName: 'As', aliases: ['As', 'As_ppm', 'ARSENIC', 'Arsenic'] },
  { standardName: 'Sb', aliases: ['Sb', 'Sb_ppm', 'ANTIMONY', 'Antimony'] },
  { standardName: 'Hg', aliases: ['Hg', 'Hg_ppm', 'Hg_ppb', 'MERCURY', 'Mercury'] },
  { standardName: 'Tl', aliases: ['Tl', 'Tl_ppm', 'THALLIUM', 'Thallium'] },
  { standardName: 'Bi', aliases: ['Bi', 'Bi_ppm', 'BISMUTH', 'Bismuth'] },
  { standardName: 'Te', aliases: ['Te', 'Te_ppm', 'TELLURIUM', 'Tellurium'] },
  { standardName: 'Se', aliases: ['Se', 'Se_ppm', 'SELENIUM', 'Selenium'] },
  { standardName: 'W', aliases: ['W', 'W_ppm', 'TUNGSTEN', 'Tungsten'] },
  { standardName: 'Mo', aliases: ['Mo', 'Mo_ppm', 'MOLYBDENUM', 'Molybdenum'] },
  { standardName: 'Sn', aliases: ['Sn', 'Sn_ppm', 'TIN', 'Tin'] },
  { standardName: 'Cu', aliases: ['Cu', 'Cu_ppm', 'Cu_pct', 'COPPER', 'Copper'] },
  { standardName: 'Pb', aliases: ['Pb', 'Pb_ppm', 'Pb_pct', 'LEAD', 'Lead'] },
  { standardName: 'Zn', aliases: ['Zn', 'Zn_ppm', 'Zn_pct', 'ZINC', 'Zinc'] },
  { standardName: 'Ni', aliases: ['Ni', 'Ni_ppm', 'NICKEL', 'Nickel'] },
  { standardName: 'Co', aliases: ['Co', 'Co_ppm', 'COBALT', 'Cobalt'] },
  { standardName: 'Cr', aliases: ['Cr', 'Cr_ppm', 'CHROMIUM', 'Chromium'] },
  { standardName: 'V', aliases: ['V', 'V_ppm', 'VANADIUM', 'Vanadium'] },
  { standardName: 'Sc', aliases: ['Sc', 'Sc_ppm', 'SCANDIUM', 'Scandium'] },
  { standardName: 'Sr', aliases: ['Sr', 'Sr_ppm', 'STRONTIUM', 'Strontium'] },
  { standardName: 'Y', aliases: ['Y', 'Y_ppm', 'YTTRIUM', 'Yttrium'] },
  { standardName: 'Zr', aliases: ['Zr', 'Zr_ppm', 'ZIRCONIUM', 'Zirconium'] },
  { standardName: 'Nb', aliases: ['Nb', 'Nb_ppm', 'NIOBIUM', 'Niobium'] },
  { standardName: 'Ta', aliases: ['Ta', 'Ta_ppm', 'TANTALUM', 'Tantalum'] },
  { standardName: 'Hf', aliases: ['Hf', 'Hf_ppm', 'HAFNIUM', 'Hafnium'] },
  { standardName: 'Th', aliases: ['Th', 'Th_ppm', 'THORIUM', 'Thorium'] },
  { standardName: 'U', aliases: ['U', 'U_ppm', 'URANIUM', 'Uranium'] },
  { standardName: 'Rb', aliases: ['Rb', 'Rb_ppm', 'RUBIDIUM', 'Rubidium'] },
  { standardName: 'Cs', aliases: ['Cs', 'Cs_ppm', 'CESIUM', 'Cesium', 'CAESIUM', 'Caesium'] },
  { standardName: 'Ba', aliases: ['Ba', 'Ba_ppm', 'BARIUM', 'Barium'] },
  { standardName: 'Li', aliases: ['Li', 'Li_ppm', 'LITHIUM', 'Lithium'] },
  { standardName: 'F', aliases: ['F', 'F_ppm', 'F_pct', 'FLUORINE', 'Fluorine'] },
  { standardName: 'P', aliases: ['P', 'P_ppm', 'P2O5', 'P2O5_pct', 'PHOSPHORUS', 'Phosphorus'] },
  { standardName: 'Mn', aliases: ['Mn', 'Mn_ppm', 'MnO', 'MnO_pct', 'MANGANESE', 'Manganese'] },
  { standardName: 'Fe', aliases: ['Fe', 'Fe_ppm', 'Fe_pct', 'Fe2O3', 'Fe2O3_pct', 'FeO', 'FeO_pct', 'IRON', 'Iron'] },
  { standardName: 'Mg', aliases: ['Mg', 'Mg_ppm', 'MgO', 'MgO_pct', 'MAGNESIUM', 'Magnesium'] },
  { standardName: 'Ca', aliases: ['Ca', 'Ca_ppm', 'CaO', 'CaO_pct', 'CALCIUM', 'Calcium'] },
  { standardName: 'Na', aliases: ['Na', 'Na_ppm', 'Na2O', 'Na2O_pct', 'SODIUM', 'Sodium'] },
  { standardName: 'K', aliases: ['K', 'K_ppm', 'K2O', 'K2O_pct', 'POTASSIUM', 'Potassium'] },
  { standardName: 'Al', aliases: ['Al', 'Al_ppm', 'Al2O3', 'Al2O3_pct', 'ALUMINUM', 'Aluminum', 'ALUMINIUM', 'Aluminium'] },
  { standardName: 'Si', aliases: ['Si', 'SiO2', 'SiO2_pct', 'SILICON', 'Silicon'] },
  { standardName: 'Ti', aliases: ['Ti', 'Ti_ppm', 'TiO2', 'TiO2_pct', 'TITANIUM', 'Titanium'] },
  // REE
  { standardName: 'La', aliases: ['La', 'La_ppm', 'LANTHANUM', 'Lanthanum'] },
  { standardName: 'Ce', aliases: ['Ce', 'Ce_ppm', 'CERIUM', 'Cerium'] },
  { standardName: 'Pr', aliases: ['Pr', 'Pr_ppm', 'PRASEODYMIUM', 'Praseodymium'] },
  { standardName: 'Nd', aliases: ['Nd', 'Nd_ppm', 'NEODYMIUM', 'Neodymium'] },
  { standardName: 'Sm', aliases: ['Sm', 'Sm_ppm', 'SAMARIUM', 'Samarium'] },
  { standardName: 'Eu', aliases: ['Eu', 'Eu_ppm', 'EUROPIUM', 'Europium'] },
  { standardName: 'Gd', aliases: ['Gd', 'Gd_ppm', 'GADOLINIUM', 'Gadolinium'] },
  { standardName: 'Tb', aliases: ['Tb', 'Tb_ppm', 'TERBIUM', 'Terbium'] },
  { standardName: 'Dy', aliases: ['Dy', 'Dy_ppm', 'DYSPROSIUM', 'Dysprosium'] },
  { standardName: 'Ho', aliases: ['Ho', 'Ho_ppm', 'HOLMIUM', 'Holmium'] },
  { standardName: 'Er', aliases: ['Er', 'Er_ppm', 'ERBIUM', 'Erbium'] },
  { standardName: 'Tm', aliases: ['Tm', 'Tm_ppm', 'THULIUM', 'Thulium'] },
  { standardName: 'Yb', aliases: ['Yb', 'Yb_ppm', 'YTTERBIUM', 'Ytterbium'] },
  { standardName: 'Lu', aliases: ['Lu', 'Lu_ppm', 'LUTETIUM', 'Lutetium'] },
  // PGE
  { standardName: 'Pt', aliases: ['Pt', 'Pt_ppb', 'Pt_ppm', 'PLATINUM', 'Platinum'] },
  { standardName: 'Pd', aliases: ['Pd', 'Pd_ppb', 'Pd_ppm', 'PALLADIUM', 'Palladium'] },
  { standardName: 'Rh', aliases: ['Rh', 'Rh_ppb', 'RHODIUM', 'Rhodium'] },
  { standardName: 'Ir', aliases: ['Ir', 'Ir_ppb', 'IRIDIUM', 'Iridium'] },
  { standardName: 'Os', aliases: ['Os', 'Os_ppb', 'OSMIUM', 'Osmium'] },
  { standardName: 'Ru', aliases: ['Ru', 'Ru_ppb', 'RUTHENIUM', 'Ruthenium'] },
];
