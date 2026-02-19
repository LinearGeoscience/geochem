/**
 * Barnes (2023) Geochemical Recalculation Types
 *
 * Types for the whole-rock recalculation wizard implementing the methodology
 * from "Lithogeochemistry in exploration for intrusion-hosted magmatic Ni-Cu-Co deposits"
 * (Supplementary Appendix 2).
 */

export type RockSuiteType = 'komatiite' | 'komatiitic-basalt' | 'mafic-cumulate' | 'custom';
export type SulfideCorrectionMethod = 'method1' | 'method2' | 'auto';

export interface OxideConversionInfo {
    element: string;              // e.g. 'Cr'
    sourceUnit: string;           // e.g. 'ppm'
    targetOxide: string;          // e.g. 'Cr2O3'
    elementToOxideFactor: number; // e.g. 1.4616
    unitConversionFactor: number; // 0.0001 for ppm, 1.0 for pct
}

export interface FeRampConfig {
    suiteType: RockSuiteType;
    mgoLow: number;      // MgO% where ratio = liquidRatio (liquid end)
    mgoHigh: number;     // MgO% where ratio = 0 (adcumulate end)
    liquidRatio: number; // Fe2O3/[FeO+Fe2O3] for liquids, default 0.1
}

export interface SulfideCorrectionConfig {
    method: SulfideCorrectionMethod;
    sThreshold: number;              // wt% S threshold for auto method selection (default 2.0)
    sm: number;                      // Molar S/[Fe+Ni] ratio (default 1.0)
    fn: number;                      // Molar Fe/Ni in sulfide for Method 2 (default 3.0)
    silicateNiOverride: number | null; // Manual silicate Ni (ppm), null = auto-calculate
}

export interface VolatileConfig {
    loiColumn: string | null;
    h2oColumn: string | null;
    co2Column: string | null;
    useLoiAsVolatile: boolean;       // true = use LOI; false = use H2O+CO2
    maxLoiFilter: number | null;     // Exclude samples with LOI > this value (null = no filter)
}

export interface ColumnAssignments {
    majorOxides: Record<string, string>; // oxide formula -> column name
    oxideConversions: Record<string, OxideConversionInfo>; // oxide -> conversion info for element fallbacks
    feColumn: string | null;             // Total Fe column
    feColumnForm: 'FeOT' | 'Fe2O3T' | 'Fe2O3' | 'FeO';
    feoColumn: string | null;            // Separate FeO column if available
    fe2o3Column: string | null;          // Separate Fe2O3 column if available
    sColumn: string | null;              // Sulfur column
    cuColumn: string | null;             // Copper column
    niColumn: string | null;             // Nickel column
    loiColumn: string | null;
    h2oColumn: string | null;
    co2Column: string | null;
}

export interface RecalculationConfig {
    columnAssignments: ColumnAssignments;
    volatileConfig: VolatileConfig;
    feRampConfig: FeRampConfig;
    sulfideConfig: SulfideCorrectionConfig;
    generateCLR: boolean;
}

export interface RecalculationSampleResult {
    volatileTotal: number;
    anhydrousTotal: number;
    fe2o3Ratio: number;        // Fe2O3/[FeO+Fe2O3] from ramp
    feoSilicate: number;       // FeO in silicate (wt%)
    fe2o3Silicate: number;     // Fe2O3 in silicate (wt%)
    sulfideMethod: 1 | 2;     // Which method was used
    niSilicate: number;        // Silicate Ni (wt%)
    niSulfide: number;         // Sulfide Ni (wt%)
    feSulfide: number;         // Fe in sulfide (wt%)
    sulfideMode: number;       // wt% sulfide in rock
    niTenor: number | null;    // Ni in 100% sulfide (wt%), null if unreliable
}

export interface RecalculationResults {
    anhydrousColumns: Record<string, number[]>;
    recalculatedColumns: Record<string, number[]>;
    diagnosticColumns: Record<string, (number | null)[]>;
    warnings: string[];
    sampleResults: RecalculationSampleResult[];
}

/** Presets for FeRampConfig by rock suite type */
export const SUITE_PRESETS: Record<RockSuiteType, Omit<FeRampConfig, 'suiteType'>> = {
    'komatiite':         { mgoLow: 25, mgoHigh: 50, liquidRatio: 0.1 },
    'komatiitic-basalt': { mgoLow: 16, mgoHigh: 48, liquidRatio: 0.1 },
    'mafic-cumulate':    { mgoLow: 10, mgoHigh: 40, liquidRatio: 0.1 },
    'custom':            { mgoLow: 10, mgoHigh: 50, liquidRatio: 0.1 },
};

/** Standard list of major oxides for recalculation (excluding Fe which is handled separately) */
export const RECALC_MAJOR_OXIDES = [
    'SiO2', 'TiO2', 'Al2O3', 'MgO', 'CaO', 'Na2O', 'K2O', 'MnO', 'P2O5', 'Cr2O3'
] as const;

/** Default column assignments */
export const DEFAULT_COLUMN_ASSIGNMENTS: ColumnAssignments = {
    majorOxides: {},
    oxideConversions: {},
    feColumn: null,
    feColumnForm: 'FeOT',
    feoColumn: null,
    fe2o3Column: null,
    sColumn: null,
    cuColumn: null,
    niColumn: null,
    loiColumn: null,
    h2oColumn: null,
    co2Column: null,
};

export const DEFAULT_RECALCULATION_CONFIG: RecalculationConfig = {
    columnAssignments: { ...DEFAULT_COLUMN_ASSIGNMENTS },
    volatileConfig: {
        loiColumn: null,
        h2oColumn: null,
        co2Column: null,
        useLoiAsVolatile: true,
        maxLoiFilter: null,
    },
    feRampConfig: {
        suiteType: 'komatiite',
        mgoLow: 25,
        mgoHigh: 50,
        liquidRatio: 0.1,
    },
    sulfideConfig: {
        method: 'auto',
        sThreshold: 2.0,
        sm: 1.0,
        fn: 3.0,
        silicateNiOverride: null,
    },
    generateCLR: false,
};
