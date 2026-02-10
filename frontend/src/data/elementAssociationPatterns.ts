/**
 * Reference Pattern Database for Element Association Recognition
 * Based on "Interpreting Element Associations" geochemistry document
 *
 * Patterns are organized into four categories:
 * - Lithological: Rock-type signatures
 * - Regolith: Weathering and surface process signatures
 * - Alteration: Hydrothermal and metasomatic signatures
 * - Mineralisation: Ore deposit signatures (highest exploration priority)
 */

import {
  ElementAssociationPattern,
  DiscriminationRule,
  ScoringConfig
} from '../types/associations';

// ============================================================================
// SCORING CONFIGURATION
// ============================================================================

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  // Weights (sum to 1.0)
  coreWeight: 0.50,
  commonWeight: 0.25,
  optionalWeight: 0.10,
  loadingStrengthWeight: 0.15,

  // Penalty
  antiElementPenalty: 0.15,

  // Loading thresholds
  loadingThresholdStrong: 0.5,
  loadingThresholdModerate: 0.3,
  loadingThresholdWeak: 0.2,

  // Confidence thresholds
  highConfidence: 70,
  moderateConfidence: 50,
  lowConfidence: 25,

  minimumConfidenceToReport: 25
};

// ============================================================================
// LITHOLOGICAL PATTERNS
// ============================================================================

const LITHOLOGICAL_PATTERNS: ElementAssociationPattern[] = [
  {
    id: 'LITH_MAFIC',
    name: 'Mafic Rock',
    category: 'lithological',
    coreElements: ['Mg', 'Sc', 'Ni', 'Cr', 'V'],
    commonElements: ['Ca', 'Co', 'Mn', 'Cu', 'Fe', 'Ti', 'Li'],
    optionalElements: ['Zn', 'P'],
    antiElements: ['Pb', 'U', 'Zr', 'Th', 'Rb', 'K', 'Cs'],
    minimumCoreMatch: 0.4,
    description: 'Signature of mafic (basaltic) rocks rich in Fe-Mg minerals',
    geologicalContext: 'Basalts, dolerites, gabbros, and their metamorphic equivalents',
    similarPatterns: ['LITH_ULTRAMAFIC'],
    discriminatingElements: ['Sc', 'Cr'],
    notes: 'Ti often loads on different PC than other mafic elements; Ultramafic rocks have higher Cr-Ni'
  },
  {
    id: 'LITH_FELSIC',
    name: 'Felsic Rock',
    category: 'lithological',
    coreElements: ['Pb', 'U', 'Zr', 'Th', 'Rb', 'K'],
    commonElements: ['Nb', 'La', 'Mo', 'Tl', 'Sn', 'W', 'Bi', 'Y', 'Hf'],
    optionalElements: ['Cs', 'Ta', 'Ce'],
    antiElements: ['Mg', 'Ni', 'Cr', 'Sc', 'V'],
    minimumCoreMatch: 0.5,
    description: 'Signature of felsic (granitic) rocks rich in incompatible elements',
    geologicalContext: 'Granites, rhyolites, pegmatites, and their metamorphic equivalents',
    similarPatterns: ['LITH_SILICLASTIC'],
    discriminatingElements: ['K', 'Rb'],
    notes: 'Modified felsic signature in siliciclastic sediments may have altered K-Rb ratios'
  },
  {
    id: 'LITH_ULTRAMAFIC',
    name: 'Ultramafic Rock',
    category: 'lithological',
    coreElements: ['Cr', 'Ni', 'Mg'],
    commonElements: ['Pt', 'Pd', 'Au', 'Co', 'Fe'],
    optionalElements: ['Cu', 'Ir', 'Os', 'Ru'],
    antiElements: ['Zr', 'Th', 'Rb', 'K', 'Pb', 'U'],
    minimumCoreMatch: 0.67,
    description: 'Signature of ultramafic rocks (komatiites, peridotites)',
    geologicalContext: 'Komatiites, dunites, peridotites, serpentinites',
    similarPatterns: ['LITH_MAFIC', 'MIN_NI_SULPHIDE'],
    discriminatingElements: ['Cr', 'Pt', 'Pd'],
    notes: 'High Cr-Ni with low Ti distinguishes from mafic; PGE presence may indicate Ni-sulphide potential'
  },
  {
    id: 'LITH_BLACK_SHALE',
    name: 'Black Shale',
    category: 'lithological',
    coreElements: ['V', 'Mo', 'U'],
    commonElements: ['Bi', 'As', 'Sb', 'Ni', 'Se', 'Re'],
    optionalElements: ['Cu', 'Zn', 'Ag', 'Cd'],
    antiElements: ['Cr', 'Ni', 'Mg'],
    minimumCoreMatch: 0.67,
    description: 'Signature of organic-rich sediments (black shales)',
    geologicalContext: 'Carbonaceous shales, oil shales, organic-rich mudstones',
    similarPatterns: ['MIN_SHMS'],
    discriminatingElements: ['V', 'Mo', 'U'],
    notes: 'V-Mo-U together without strong Pb-Zn suggests organic matter enrichment rather than SHMS'
  },
  {
    id: 'LITH_CARBONATE',
    name: 'Carbonate Rock',
    category: 'lithological',
    coreElements: ['Mg', 'Ca', 'Sr'],
    commonElements: ['Mn', 'Ba'],
    optionalElements: ['Fe', 'Zn'],
    antiElements: ['Al', 'K', 'Rb', 'Zr', 'Ti'],
    minimumCoreMatch: 0.67,
    description: 'Signature of carbonate rocks (limestones, dolomites)',
    geologicalContext: 'Limestones, dolomites, marbles, carbonatites',
    similarPatterns: ['ALT_CARBONATE', 'REG_CALCRETE'],
    discriminatingElements: ['Sr'],
    notes: 'Distinguish from alteration by spatial distribution; calcrete has different trace element ratios'
  },
  {
    id: 'LITH_SILICLASTIC',
    name: 'Siliclastic Sediment',
    category: 'lithological',
    coreElements: ['Zr', 'Th', 'Rb', 'K'],
    commonElements: ['Al', 'Ti', 'Hf', 'Y', 'La'],
    optionalElements: ['Ce', 'Nb'],
    antiElements: ['Ni', 'Cr', 'Mg'],
    minimumCoreMatch: 0.5,
    description: 'Modified felsic signature in siliciclastic sediments',
    geologicalContext: 'Sandstones, siltstones, mudstones, greywackes',
    similarPatterns: ['LITH_FELSIC'],
    discriminatingElements: ['Al', 'Ti'],
    notes: 'Similar to felsic but with weathering modification; clay content indicated by Al'
  },
  {
    id: 'LITH_HOST_ROCK',
    name: 'Host Rock (Resistate Elements)',
    category: 'lithological',
    coreElements: ['Y', 'Al', 'Ti', 'Zr', 'Hf', 'Ga'],
    commonElements: ['Nb', 'P', 'Fe', 'V', 'Ce', 'Sr', 'Sc', 'Ta', 'La', 'Th'],
    optionalElements: ['Na', 'Mg', 'Co', 'Mn', 'Ca', 'Be', 'Ni', 'U', 'Ge'],
    antiElements: [],
    minimumCoreMatch: 0.5,
    description: 'General host rock signature with resistate/immobile elements',
    geologicalContext: 'Background lithology, siliciclastic with heavy mineral component',
    similarPatterns: ['LITH_SILICLASTIC', 'LITH_FELSIC', 'REG_HEAVY_MIN'],
    discriminatingElements: ['Y', 'Ga', 'Hf'],
    notes: 'Composite of heavy mineral lag and siliciclastic signatures; represents "background" lithology'
  },
  {
    id: 'LITH_GRANITIOID',
    name: 'Evolved Granitoid',
    category: 'lithological',
    coreElements: ['Cs', 'Li', 'Rb', 'Sn', 'W'],
    commonElements: ['Mo', 'Bi', 'Ta', 'Nb', 'U', 'Th'],
    optionalElements: ['Be', 'F', 'K'],
    antiElements: ['Mg', 'Ni', 'Cr'],
    minimumCoreMatch: 0.4,
    description: 'Highly evolved felsic intrusive signature',
    geologicalContext: 'Fractionated granites, pegmatites, aplites',
    similarPatterns: ['LITH_FELSIC', 'MIN_SN_W_MO', 'ALT_WHITE_MICA'],
    discriminatingElements: ['Cs', 'Sn', 'Ta'],
    notes: 'More evolved than generic felsic; Cs-Li-Rb indicate extreme fractionation. May host Sn-W mineralisation'
  }
];

// ============================================================================
// REGOLITH PATTERNS
// ============================================================================

const REGOLITH_PATTERNS: ElementAssociationPattern[] = [
  {
    id: 'REG_FE_SCAV',
    name: 'Fe-Scavenging',
    category: 'regolith',
    coreElements: ['Fe', 'As', 'Sb', 'Bi'],
    commonElements: ['Pb', 'Mo', 'In', 'W', 'Sn'],
    optionalElements: ['Cu', 'Zn', 'Ag'],
    antiElements: [],
    minimumCoreMatch: 0.5,
    description: 'Elements adsorbed onto Fe-oxides/oxyhydroxides during weathering',
    geologicalContext: 'Lateritic profiles, Fe-rich saprolite, ferricrete, gossans',
    similarPatterns: ['REG_MN_SCAV'],
    discriminatingElements: ['Fe', 'In'],
    notes: 'May overlap with Mn-scavenging; In is more Fe-specific. Can obscure or enhance primary mineralisation signatures'
  },
  {
    id: 'REG_MN_SCAV',
    name: 'Mn-Scavenging',
    category: 'regolith',
    coreElements: ['Mn', 'Co', 'Ni', 'Cu'],
    commonElements: ['Zn', 'Cd', 'Tl', 'Ba', 'Ce'],
    optionalElements: ['Pb', 'Mo'],
    antiElements: [],
    minimumCoreMatch: 0.5,
    description: 'Elements adsorbed onto Mn-oxides during weathering',
    geologicalContext: 'Mn-rich saprolite, desert varnish, Mn-nodules',
    similarPatterns: ['REG_FE_SCAV'],
    discriminatingElements: ['Mn', 'Co', 'Cd'],
    notes: 'May overlap with Fe-scavenging; Cd and Ce are more Mn-specific. Consider Mn/Co ratios'
  },
  {
    id: 'REG_WEATHERED',
    name: 'Weathered Profile',
    category: 'regolith',
    coreElements: ['Fe', 'In', 'Sn', 'V', 'As'],
    commonElements: ['Al', 'Ga', 'Ti', 'Nb'],
    optionalElements: ['W', 'Mo'],
    antiElements: ['Na', 'Ca', 'Sr', 'S'],
    minimumCoreMatch: 0.4,
    description: 'Elements concentrated in weathered/oxidized material',
    geologicalContext: 'Saprolite, laterite, oxidized zone, soil',
    similarPatterns: ['REG_FRESH'],
    discriminatingElements: ['In', 'V'],
    notes: 'Mutually exclusive with Fresh signature; In and V are weathering indicators'
  },
  {
    id: 'REG_FRESH',
    name: 'Fresh Rock',
    category: 'regolith',
    coreElements: ['Na', 'Ca', 'Sr', 'S'],
    commonElements: ['Mg', 'Ba'],
    optionalElements: ['K', 'Mn'],
    antiElements: ['Fe', 'In', 'Sn', 'V'],
    minimumCoreMatch: 0.5,
    description: 'Elements preserved in fresh (unweathered) rock',
    geologicalContext: 'Unweathered bedrock, fresh drill core, reduced zone',
    similarPatterns: ['REG_WEATHERED'],
    discriminatingElements: ['Na', 'S'],
    notes: 'Mutually exclusive with Weathered signature; Na and S are lost during weathering'
  },
  {
    id: 'REG_DETRITAL_MICA',
    name: 'Detrital Mica',
    category: 'regolith',
    coreElements: ['K', 'Tl', 'Rb', 'Cs', 'Ba'],
    commonElements: ['Li', 'Ga'],
    optionalElements: ['F', 'B'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Elements associated with detrital mica in sediments',
    geologicalContext: 'Mica-bearing sediments, soil, saprolite',
    similarPatterns: ['ALT_HT_MICA'],
    discriminatingElements: [],
    notes: 'Cannot discriminate from hydrothermal mica on elements alone - requires spatial/geological context'
  },
  {
    id: 'REG_CALCRETE',
    name: 'Calcrete',
    category: 'regolith',
    coreElements: ['Ca', 'Mg', 'Sr'],
    commonElements: ['Au', 'Ba', 'U'],
    optionalElements: ['Mo', 'V'],
    antiElements: ['Al', 'K'],
    minimumCoreMatch: 0.67,
    description: 'Pedogenic/groundwater carbonate accumulation',
    geologicalContext: 'Arid zone calcrete, valley calcrete, palaeochannels',
    similarPatterns: ['LITH_CARBONATE', 'ALT_CARBONATE'],
    discriminatingElements: ['Au', 'U'],
    notes: 'Au-in-calcrete is an important exploration target in arid regions; U can also concentrate'
  },
  {
    id: 'REG_HEAVY_MIN',
    name: 'Heavy Mineral Lag',
    category: 'regolith',
    coreElements: ['Fe', 'V', 'Zr', 'Cr', 'Ti'],
    commonElements: ['Th', 'Nb', 'Sn', 'Y', 'Au', 'Pt', 'Pd', 'Hf'],
    optionalElements: ['W', 'Ce', 'La'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Concentrated heavy/resistate minerals in regolith',
    geologicalContext: 'Laterite, deflation lag, stream sediments, beach sands',
    similarPatterns: ['LITH_MAFIC', 'LITH_FELSIC'],
    discriminatingElements: ['V', 'Zr', 'Cr'],
    notes: 'Mix of mafic (V-Cr) and felsic (Zr-Th) resistate elements; indicates physical concentration'
  }
];

// ============================================================================
// ALTERATION PATTERNS
// ============================================================================

const ALTERATION_PATTERNS: ElementAssociationPattern[] = [
  {
    id: 'ALT_HT_MICA',
    name: 'Hydrothermal Mica',
    category: 'alteration',
    coreElements: ['K', 'Tl', 'Rb', 'Cs', 'Ba'],
    commonElements: ['Li', 'F', 'B', 'W'],
    optionalElements: ['Sn', 'Mo'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Sericite/muscovite alteration from hydrothermal fluids',
    geologicalContext: 'Phyllic alteration zone, sericite halos, greisen',
    similarPatterns: ['REG_DETRITAL_MICA', 'ALT_WHITE_MICA'],
    discriminatingElements: ['W', 'Li'],
    notes: 'W and Li enrichment suggests hydrothermal origin; requires context to discriminate from detrital'
  },
  {
    id: 'ALT_WHITE_MICA',
    name: 'White Mica Alteration',
    category: 'alteration',
    coreElements: ['Cs', 'Li', 'K', 'Rb'],
    commonElements: ['Tl', 'Ba', 'F', 'B', 'W'],
    optionalElements: ['Sn', 'Au'],
    antiElements: ['Mg', 'Ca'],
    minimumCoreMatch: 0.5,
    description: 'Muscovite/sericite alteration from Li-Cs enriched fluids',
    geologicalContext: 'Phyllic alteration zones, Li-rich granitic systems, sericite halos around mineralisation',
    similarPatterns: ['ALT_HT_MICA', 'REG_DETRITAL_MICA', 'LITH_GRANITIOID'],
    discriminatingElements: ['Cs', 'Li'],
    notes: 'Cs-Li together strongly indicates evolved hydrothermal system. Often associated with mineralisation halos'
  },
  {
    id: 'ALT_CARBONATE',
    name: 'Carbonate Alteration',
    category: 'alteration',
    coreElements: ['Ca', 'Sr', 'Mg'],
    commonElements: ['Mn', 'Ba', 'Fe'],
    optionalElements: ['Zn', 'Pb'],
    antiElements: [],
    minimumCoreMatch: 0.67,
    description: 'Carbonate flooding/veining from hydrothermal fluids',
    geologicalContext: 'Propylitic alteration, carbonate veins, listwanite, carbonatisation',
    similarPatterns: ['LITH_CARBONATE', 'REG_CALCRETE'],
    discriminatingElements: ['Mn', 'Fe'],
    notes: 'Elevated Mn-Fe with Ca-Mg-Sr may indicate hydrothermal carbonate vs primary carbonate rock'
  },
  {
    id: 'ALT_ALBITE',
    name: 'Albite (Na) Alteration',
    category: 'alteration',
    coreElements: ['Na', 'Al'],
    commonElements: ['Si'],
    optionalElements: ['Sr', 'Ca'],
    antiElements: ['K', 'Rb'],
    minimumCoreMatch: 0.5,
    description: 'Sodic alteration replacing K-feldspar and plagioclase',
    geologicalContext: 'IOCG alteration, sodic-calcic alteration, albitite',
    similarPatterns: [],
    discriminatingElements: ['Na'],
    notes: 'May mix with metal signature in IOCG systems; look for Cu-Au association'
  },
  {
    id: 'ALT_CHLORITE',
    name: 'Chlorite Alteration',
    category: 'alteration',
    coreElements: ['Fe', 'Mg'],
    commonElements: ['Mn', 'Al', 'V'],
    optionalElements: ['Ti', 'Zn'],
    antiElements: ['K', 'Na'],
    minimumCoreMatch: 0.5,
    description: 'Chlorite replacing mafic minerals and biotite',
    geologicalContext: 'Propylitic alteration, chlorite halos, VMS footwall',
    similarPatterns: ['LITH_MAFIC'],
    discriminatingElements: ['V'],
    notes: 'May mix with metal signature; elevated V with Fe-Mg suggests chlorite rather than primary mafic'
  },
  {
    id: 'ALT_SILICA',
    name: 'Silica Alteration',
    category: 'alteration',
    coreElements: ['Si'],
    commonElements: ['Au', 'Ag', 'As', 'Sb'],
    optionalElements: ['Hg', 'Tl'],
    antiElements: ['Na', 'Ca', 'K'],
    minimumCoreMatch: 1.0,
    description: 'Silicification associated with mineralisation',
    geologicalContext: 'Quartz veins, silica caps, jasperoid, epithermal systems',
    similarPatterns: ['MIN_EPITHERMAL'],
    discriminatingElements: ['Si'],
    notes: 'Si rarely measured in exploration; inferred from low mobile elements (Na, Ca, K)'
  },
  {
    id: 'ALT_POTASSIC',
    name: 'Potassic Alteration',
    category: 'alteration',
    coreElements: ['K', 'Rb', 'Ba'],
    commonElements: ['Fe', 'Mg', 'Cu', 'Au'],
    optionalElements: ['Bi', 'Te'],
    antiElements: ['Na'],
    minimumCoreMatch: 0.67,
    description: 'K-feldspar and/or biotite alteration (porphyry cores)',
    geologicalContext: 'Porphyry Cu-Au core zones, some IOCG systems',
    similarPatterns: ['ALT_HT_MICA', 'MIN_PORPHYRY_CU'],
    discriminatingElements: ['Cu', 'Au'],
    notes: 'K with Cu-Au suggests porphyry potassic core; without metals may be barren alteration'
  }
];

// ============================================================================
// MINERALISATION PATTERNS (HIGHEST PRIORITY)
// ============================================================================

const MINERALISATION_PATTERNS: ElementAssociationPattern[] = [
  {
    id: 'MIN_VHMS',
    name: 'VHMS (VMS) Mineralisation',
    category: 'mineralisation',
    coreElements: ['Sn', 'Bi', 'In', 'Au', 'Ag'],
    commonElements: ['As', 'Sb', 'Hg', 'Te', 'Se', 'Cu', 'Zn', 'Cd', 'Pb'],
    optionalElements: ['Mo', 'W', 'Tl'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Volcanic-hosted massive sulphide mineralisation',
    geologicalContext: 'Submarine volcanic sequences, syngenetic to diagenetic',
    similarPatterns: ['MIN_SHMS'],
    discriminatingElements: ['Sn', 'Bi', 'In'],
    notes: 'In-Sn-Bi are key discriminators; Cu-Zn may be depleted by weathering. Au often with proximal Zn-rich ores'
  },
  {
    id: 'MIN_OROG_AU_1',
    name: 'Orogenic Au (Te-rich)',
    category: 'mineralisation',
    coreElements: ['Au', 'Ag', 'Bi', 'Mo', 'Te', 'W'],
    commonElements: ['As', 'Cu', 'Sb'],
    optionalElements: ['Se', 'Pb', 'Hg'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Orogenic gold with telluride-bismuth association',
    geologicalContext: 'Archean-Paleoproterozoic greenstones, higher-grade systems',
    similarPatterns: ['MIN_OROG_AU_2', 'MIN_INTRU_AU'],
    discriminatingElements: ['Te', 'Bi'],
    notes: 'Te-Bi enrichment characterises Type 1; often higher-grade ore shoots'
  },
  {
    id: 'MIN_OROG_AU_2',
    name: 'Orogenic Au (As-Sb-rich)',
    category: 'mineralisation',
    coreElements: ['Au', 'Ag', 'As', 'Sb', 'W'],
    commonElements: ['Te', 'Bi', 'Hg'],
    optionalElements: ['Mo', 'Cu', 'Pb', 'Zn'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Orogenic gold with arsenopyrite-stibnite association',
    geologicalContext: 'Orogenic gold belts, shear zones, often lower-grade halos',
    similarPatterns: ['MIN_OROG_AU_1', 'MIN_EPITHERMAL'],
    discriminatingElements: ['As', 'Sb'],
    notes: 'As-Sb dominant over Te-Bi; may indicate pathfinder halo rather than high-grade core'
  },
  {
    id: 'MIN_PORPHYRY_CU',
    name: 'Porphyry Cu(-Au-Mo)',
    category: 'mineralisation',
    coreElements: ['Cu', 'Au', 'Ag', 'Mo', 'Bi', 'Te'],
    commonElements: ['Re', 'Se', 'Pd', 'Pt'],
    optionalElements: ['W', 'Sn', 'In'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Porphyry copper (± gold ± molybdenum) core zone signature',
    geologicalContext: 'Intrusion-centered hydrothermal systems, potassic core',
    similarPatterns: ['MIN_IOCG'],
    discriminatingElements: ['Mo', 'Re'],
    notes: 'Zones outward to Pb-Zn-Ag (phyllic) then As-Sb-Tl (distal). Mo-Re distinguish from IOCG'
  },
  {
    id: 'MIN_SHMS',
    name: 'SHMS (SEDEX) Mineralisation',
    category: 'mineralisation',
    coreElements: ['Pb', 'Zn', 'Cd', 'Ag'],
    commonElements: ['As', 'Sb', 'Tl', 'Hg', 'Ba'],
    optionalElements: ['Mn', 'Fe', 'Bi'],
    antiElements: [],
    minimumCoreMatch: 0.5,
    description: 'Sediment-hosted massive sulphide mineralisation',
    geologicalContext: 'Rift basins, black shale sequences, exhalative-diagenetic',
    similarPatterns: ['MIN_MVT', 'MIN_VHMS'],
    discriminatingElements: ['Tl', 'Hg'],
    notes: 'Tl-Hg association stronger than MVT; Ba may indicate barite'
  },
  {
    id: 'MIN_MVT',
    name: 'MVT Mineralisation',
    category: 'mineralisation',
    coreElements: ['Pb', 'Zn', 'Cd', 'Ag'],
    commonElements: ['As', 'Sb', 'Cu', 'Ni', 'Co'],
    optionalElements: ['Ge', 'Ga', 'Fe'],
    antiElements: ['Tl', 'Hg'],
    minimumCoreMatch: 0.5,
    description: 'Mississippi Valley-type carbonate-hosted Pb-Zn',
    geologicalContext: 'Platform carbonates, epigenetic replacement',
    similarPatterns: ['MIN_SHMS'],
    discriminatingElements: ['Ge', 'Ga'],
    notes: 'Typically lacks strong Tl-Hg; Ge-Ga can be enriched. More Ni-Co than SHMS'
  },
  {
    id: 'MIN_NI_SULPHIDE',
    name: 'Ni-Cu-PGE Sulphide',
    category: 'mineralisation',
    coreElements: ['Ni', 'Cu', 'Pt', 'Pd', 'Te'],
    commonElements: ['Co', 'Au', 'Se', 'Ir', 'Os', 'Ru', 'Rh'],
    optionalElements: ['S', 'Cr'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Magmatic Ni-Cu sulphide mineralisation',
    geologicalContext: 'Mafic-ultramafic intrusions, komatiites, conduits',
    similarPatterns: ['LITH_ULTRAMAFIC'],
    discriminatingElements: ['Pt', 'Pd', 'Cu'],
    notes: 'PGE enrichment and Cu presence distinguish from barren ultramafic; elevated PGE/S ratio indicates ore'
  },
  {
    id: 'MIN_IOCG',
    name: 'IOCG Mineralisation',
    category: 'mineralisation',
    coreElements: ['Cu', 'Au', 'Fe', 'In', 'Bi', 'Te'],
    commonElements: ['U', 'La', 'Mo', 'Ag', 'Co', 'Ni', 'REE'],
    optionalElements: ['Sn', 'W', 'Ba'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Iron oxide copper-gold mineralisation',
    geologicalContext: 'Magnetite-hematite breccias, sodic-calcic alteration zones',
    similarPatterns: ['MIN_PORPHYRY_CU'],
    discriminatingElements: ['Fe', 'U', 'La', 'In'],
    notes: 'Fe-rich with U-LREE distinguishes from porphyry Cu; In enrichment characteristic'
  },
  {
    id: 'MIN_EPITHERMAL',
    name: 'Epithermal Au-Ag',
    category: 'mineralisation',
    coreElements: ['Au', 'Ag', 'Hg', 'Tl', 'As', 'Sb'],
    commonElements: ['Se', 'Te', 'Pb', 'Zn', 'Cu'],
    optionalElements: ['Bi', 'Mo', 'Mn'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Epithermal low-to-intermediate sulphidation Au-Ag',
    geologicalContext: 'Volcanic-hosted, shallow crustal, hot springs environment',
    similarPatterns: ['MIN_OROG_AU_2'],
    discriminatingElements: ['Hg', 'Tl'],
    notes: 'Hg-Tl enrichment distinguishes from orogenic Au; often Mn enrichment in LS epithermal'
  },
  {
    id: 'MIN_SN_W_MO',
    name: 'Sn-W-Mo Mineralisation',
    category: 'mineralisation',
    coreElements: ['Sn', 'W', 'Mo', 'Bi'],
    commonElements: ['As', 'Sb', 'Cu', 'Li', 'F', 'B'],
    optionalElements: ['In', 'Nb', 'Ta', 'Ag'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Granite-related tin-tungsten-molybdenum mineralisation',
    geologicalContext: 'Greisen, pegmatites, skarns, quartz veins around felsic intrusions',
    similarPatterns: ['MIN_INTRU_AU'],
    discriminatingElements: ['Sn', 'Li', 'F'],
    notes: 'Sn-Li-F-B indicates greisen/pegmatite affinity; W-Mo-Bi without Sn still matches this system'
  },
  {
    id: 'MIN_INTRU_AU',
    name: 'Intrusion-Related Au',
    category: 'mineralisation',
    coreElements: ['Au', 'Bi', 'Te', 'Mo', 'W', 'As'],
    commonElements: ['Sb', 'Cu', 'Ag', 'Sn'],
    optionalElements: ['Pb', 'Zn', 'In'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Reduced intrusion-related gold systems',
    geologicalContext: 'Sheeted veins, skarns, and replacements around felsic plutons',
    similarPatterns: ['MIN_OROG_AU_1', 'MIN_SN_W_MO'],
    discriminatingElements: ['Mo', 'W'],
    notes: 'Similar to orogenic Au Type 1 but with Mo-W association indicating intrusive heat source'
  },
  {
    id: 'MIN_CARLIN',
    name: 'Carlin-type Au',
    category: 'mineralisation',
    coreElements: ['Au', 'As', 'Sb', 'Hg', 'Tl'],
    commonElements: ['Te', 'Ba', 'W', 'Mo'],
    optionalElements: ['Ag', 'Pb', 'Zn'],
    antiElements: ['Cu'],
    minimumCoreMatch: 0.4,
    description: 'Carlin-type sediment-hosted disseminated gold',
    geologicalContext: 'Carbonaceous calcareous sediments, jasperoids, decalcified zones',
    similarPatterns: ['MIN_EPITHERMAL'],
    discriminatingElements: ['Tl', 'Ba'],
    notes: 'Characteristic As-Sb-Hg-Tl without Cu; Ba from dissolution of carbonate. Low Cu distinguishes from epithermal'
  },
  {
    id: 'MIN_SKARN',
    name: 'Skarn Mineralisation',
    category: 'mineralisation',
    coreElements: ['Cu', 'Zn', 'Pb', 'W', 'Mo', 'Sn'],
    commonElements: ['Au', 'Ag', 'Bi', 'As', 'Fe', 'In'],
    optionalElements: ['Co', 'Mn', 'F'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Contact metasomatic skarn mineralisation',
    geologicalContext: 'Intrusion-carbonate contacts, calc-silicate rocks',
    similarPatterns: ['MIN_PORPHYRY_CU', 'MIN_SN_W_MO'],
    discriminatingElements: ['Zn', 'Fe'],
    notes: 'Variety of metal associations depending on skarn type (Cu-Au, Zn-Pb, W-Mo, Sn). Fe-silicate gangue'
  },
  {
    id: 'MIN_CU_AU_BRECCIA',
    name: 'Cu-Au Breccia Pipe',
    category: 'mineralisation',
    coreElements: ['Cu', 'Au', 'Fe', 'Bi', 'Te'],
    commonElements: ['Ag', 'Mo', 'As', 'Pb', 'Zn'],
    optionalElements: ['K', 'Ba'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Cu-Au hosted in hydrothermal breccia pipes',
    geologicalContext: 'Breccia pipes, diatremes, hydrothermal breccias',
    similarPatterns: ['MIN_PORPHYRY_CU', 'MIN_IOCG'],
    discriminatingElements: ['Fe', 'Bi'],
    notes: 'Overlaps with porphyry and IOCG; Fe-rich matrix, often zoned from Cu-Au core to Pb-Zn halo'
  },
  {
    id: 'MIN_SHMS_WEATHERED',
    name: 'SHMS (Weathered/Pb-depleted)',
    category: 'mineralisation',
    coreElements: ['Zn', 'Cd', 'Ag', 'Sb', 'As'],
    commonElements: ['Tl', 'Pb', 'Hg', 'Ba', 'S'],
    optionalElements: ['Mn', 'Fe', 'Bi', 'W'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Weathered SEDEX/SHMS signature where Pb may be depleted',
    geologicalContext: 'Regolith-dominated datasets, oxidized SHMS/SEDEX ores',
    similarPatterns: ['MIN_SHMS', 'MIN_MVT'],
    discriminatingElements: ['Cd', 'Sb'],
    notes: 'Common in regolith-dominated datasets; Pb often below detection or threshold'
  },
  {
    id: 'MIN_ALT_SULPHIDE_SERICITE',
    name: 'Sulphide + Sericite Overprint',
    category: 'mineralisation',
    coreElements: ['Ag', 'Zn', 'Cd', 'As', 'Sb'],
    commonElements: ['K', 'Tl', 'Rb', 'Cs', 'S', 'W', 'Bi'],
    optionalElements: ['Pb', 'Ba'],
    antiElements: [],
    minimumCoreMatch: 0.4,
    description: 'Base metal mineralisation with sericite alteration overprint',
    geologicalContext: 'SHMS/SEDEX systems with phyllic alteration halo',
    similarPatterns: ['MIN_SHMS', 'ALT_HT_MICA'],
    discriminatingElements: ['Tl', 'Cs'],
    notes: 'Mixed signature where ore metals load with mica-related elements; common around SHMS deposits'
  }
];

// ============================================================================
// COMBINE ALL PATTERNS
// ============================================================================

export const REFERENCE_PATTERNS: ElementAssociationPattern[] = [
  ...LITHOLOGICAL_PATTERNS,
  ...REGOLITH_PATTERNS,
  ...ALTERATION_PATTERNS,
  ...MINERALISATION_PATTERNS
];

// Pattern lookup by ID
export const PATTERN_BY_ID: Record<string, ElementAssociationPattern> =
  REFERENCE_PATTERNS.reduce((acc, pattern) => {
    acc[pattern.id] = pattern;
    return acc;
  }, {} as Record<string, ElementAssociationPattern>);

// Patterns by category
export const PATTERNS_BY_CATEGORY: Record<string, ElementAssociationPattern[]> = {
  lithological: LITHOLOGICAL_PATTERNS,
  regolith: REGOLITH_PATTERNS,
  alteration: ALTERATION_PATTERNS,
  mineralisation: MINERALISATION_PATTERNS
};

// ============================================================================
// DISCRIMINATION RULES
// ============================================================================

export const DISCRIMINATION_RULES: DiscriminationRule[] = [
  {
    pattern1: 'LITH_FELSIC',
    pattern2: 'LITH_SILICLASTIC',
    discriminators: ['K', 'Rb', 'U', 'Pb'],
    rule: 'Strong K-Rb-U-Pb loadings favor Felsic over Siliclastic. Felsic has more primary mineralogy elements',
    requiresContext: false
  },
  {
    pattern1: 'ALT_WHITE_MICA',
    pattern2: 'LITH_GRANITIOID',
    discriminators: ['Sn', 'W', 'Ta', 'Au'],
    rule: 'Sn-W-Ta indicates granitoid source; Au suggests alteration halo. Context needed for discrimination',
    requiresContext: true
  },
  {
    pattern1: 'REG_DETRITAL_MICA',
    pattern2: 'ALT_HT_MICA',
    discriminators: ['W', 'Li', 'context'],
    rule: 'W and Li enrichment suggests hydrothermal; requires spatial/geological context',
    requiresContext: true
  },
  {
    pattern1: 'MIN_OROG_AU_1',
    pattern2: 'MIN_OROG_AU_2',
    discriminators: ['Te', 'As', 'Sb'],
    rule: 'Compare Te loading vs As-Sb loadings. Type 1 has higher Te; Type 2 has higher As-Sb',
    requiresContext: false
  },
  {
    pattern1: 'MIN_SHMS',
    pattern2: 'MIN_MVT',
    discriminators: ['Tl', 'Hg', 'Ge', 'Ga'],
    rule: 'SHMS has Tl-Hg association; MVT typically lacks these but may have Ge-Ga',
    requiresContext: false
  },
  {
    pattern1: 'REG_FE_SCAV',
    pattern2: 'REG_MN_SCAV',
    discriminators: ['Fe', 'Mn', 'In', 'Cd'],
    rule: 'Compare Fe vs Mn loadings. In is Fe-specific; Cd is Mn-specific',
    requiresContext: false
  },
  {
    pattern1: 'MIN_PORPHYRY_CU',
    pattern2: 'MIN_IOCG',
    discriminators: ['Mo', 'Re', 'Fe', 'U', 'La'],
    rule: 'Mo-Re indicates porphyry; Fe-U-La-REE indicates IOCG',
    requiresContext: false
  },
  {
    pattern1: 'LITH_CARBONATE',
    pattern2: 'ALT_CARBONATE',
    discriminators: ['Mn', 'Fe', 'context'],
    rule: 'Elevated Mn-Fe with Ca-Mg-Sr may indicate hydrothermal; requires spatial distribution',
    requiresContext: true
  },
  {
    pattern1: 'MIN_EPITHERMAL',
    pattern2: 'MIN_OROG_AU_2',
    discriminators: ['Hg', 'Tl', 'Mn'],
    rule: 'Hg-Tl and Mn enrichment indicate epithermal over orogenic Au',
    requiresContext: false
  },
  {
    pattern1: 'MIN_VHMS',
    pattern2: 'MIN_SHMS',
    discriminators: ['Sn', 'Bi', 'In'],
    rule: 'Sn-Bi-In association indicates VHMS over SHMS',
    requiresContext: false
  },
  {
    pattern1: 'LITH_MAFIC',
    pattern2: 'LITH_ULTRAMAFIC',
    discriminators: ['Ti', 'Sc', 'Cr'],
    rule: 'Ultramafic has higher Cr/Ti and Cr/Sc ratios; lower Ti-Sc overall',
    requiresContext: false
  },
  {
    pattern1: 'MIN_INTRU_AU',
    pattern2: 'MIN_OROG_AU_1',
    discriminators: ['Mo', 'W', 'Sn'],
    rule: 'Mo-W-Sn together indicates intrusion-related over purely orogenic',
    requiresContext: false
  },
  {
    pattern1: 'MIN_CARLIN',
    pattern2: 'MIN_EPITHERMAL',
    discriminators: ['Cu', 'Tl', 'Ba'],
    rule: 'Carlin lacks Cu, has strong Tl-Ba; epithermal may have Cu',
    requiresContext: false
  }
];

// ============================================================================
// HELPER: Get all unique elements in database
// ============================================================================

export function getAllPatternElements(): string[] {
  const elements = new Set<string>();

  for (const pattern of REFERENCE_PATTERNS) {
    pattern.coreElements.forEach(e => elements.add(e));
    pattern.commonElements.forEach(e => elements.add(e));
    pattern.optionalElements.forEach(e => elements.add(e));
    pattern.antiElements.forEach(e => elements.add(e));
  }

  return Array.from(elements).sort();
}

// ============================================================================
// CATEGORY DISPLAY NAMES & COLORS
// ============================================================================

export const CATEGORY_INFO = {
  mineralisation: {
    displayName: 'Mineralisation',
    color: '#22c55e',  // green-500
    bgColor: '#dcfce7', // green-100
    priority: 1
  },
  alteration: {
    displayName: 'Alteration',
    color: '#f59e0b',  // amber-500
    bgColor: '#fef3c7', // amber-100
    priority: 2
  },
  regolith: {
    displayName: 'Regolith',
    color: '#8b5cf6',  // violet-500
    bgColor: '#ede9fe', // violet-100
    priority: 3
  },
  lithological: {
    displayName: 'Lithological',
    color: '#6b7280',  // gray-500
    bgColor: '#f3f4f6', // gray-100
    priority: 4
  }
} as const;
