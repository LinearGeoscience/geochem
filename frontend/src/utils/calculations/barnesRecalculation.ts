/**
 * Barnes (2023) Geochemical Recalculation Engine
 *
 * Implements the whole-rock recalculation methodology from:
 * Barnes, S.J. (2023) "Lithogeochemistry in exploration for intrusion-hosted
 * magmatic Ni-Cu-Co deposits" — Supplementary Appendix 2
 *
 * Pipeline:
 * 1. Volatile-free (anhydrous) normalization
 * 2. Fe2O3/FeO splitting via MgO-dependent ramp function
 * 3. Sulfide correction (Method 1 or Method 2)
 * 4. Sulfide-free renormalization with split Fe
 */

import {
    ColumnAssignments,
    VolatileConfig,
    FeRampConfig,
    SulfideCorrectionConfig,
    RecalculationConfig,
    RecalculationSampleResult,
    RecalculationResults,
    RECALC_MAJOR_OXIDES,
} from '../../types/recalculation';
import { ATOMIC_WEIGHTS, IRON_OXIDE_CONVERSIONS, UNIT_CONVERSIONS } from './constants';

// ============================================================================
// VALIDATION CONSTANTS — geochemical plausibility gates
// ============================================================================

/** Minimum acceptable raw analytical total (wt%). Below this the analysis is
 *  incomplete (e.g. missing LOI in serpentinites) and normalizing to 100%
 *  produces meaningless oxide values. Rollinson (1993) recommends 98.5–101%
 *  for high-quality data; 85% is a generous lower bound. */
const MIN_RAW_TOTAL = 85;

/** Maximum plausible MgO in a recalculated silicate composition (wt%).
 *  Pure forsterite olivine is 57.3% MgO; no natural cumulate exceeds ~52%. */
const MAX_MGO_RECALC = 52;

/** Maximum plausible total Fe oxide (FeO + Fe₂O₃) in a recalculated silicate
 *  composition (wt%). Values above 30% indicate massive oxide (magnetite)
 *  rather than silicate rock — Barnes method is not applicable. */
const MAX_FEOT_RECALC = 30;

/** Maximum sulfide mode (wt%) for which recalculated silicate compositions
 *  are considered reliable. Above 50% the rock is dominantly sulfide and the
 *  residual silicate fraction is too small to normalize meaningfully. */
const MAX_SULFIDE_MODE = 50;

// ============================================================================
// HELPER: Safe numeric extraction
// ============================================================================

function getNum(row: Record<string, any>, col: string | null): number | null {
    if (!col) return null;
    const v = row[col];
    if (v === null || v === undefined || v === '' || v === 'NA' || v === 'N/A') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[<>,%$]/g, '').trim());
    return isNaN(n) ? null : n;
}

function safeNum(v: number | null, fallback: number = 0): number {
    return v !== null && !isNaN(v) ? v : fallback;
}

// ============================================================================
// STEP 1: Convert total Fe to FeO-total (wt%)
// ============================================================================

/**
 * Get total iron as FeO (wt%) from whatever form is reported.
 */
function getTotalFeAsFeO(
    row: Record<string, any>,
    assignments: ColumnAssignments
): number {
    // If separate FeO and Fe2O3 are both available, combine them
    if (assignments.feoColumn && assignments.fe2o3Column) {
        const feo = safeNum(getNum(row, assignments.feoColumn));
        const fe2o3 = safeNum(getNum(row, assignments.fe2o3Column));
        return feo + fe2o3 * IRON_OXIDE_CONVERSIONS.Fe2O3_to_FeO;
    }

    // Use the total Fe column
    const feVal = safeNum(getNum(row, assignments.feColumn));
    switch (assignments.feColumnForm) {
        case 'FeOT':
        case 'FeO':
            return feVal;
        case 'Fe2O3T':
        case 'Fe2O3':
            return feVal * IRON_OXIDE_CONVERSIONS.Fe2O3_to_FeO;
        default:
            return feVal;
    }
}

// ============================================================================
// STEP 2: Anhydrous (volatile-free) normalization
// ============================================================================

export interface AnhydrousResult {
    oxides: Record<string, number>;  // oxide formula -> anhydrous wt%
    feOT: number;                    // Total Fe as FeO, anhydrous
    s: number;                       // S wt%, anhydrous
    cu: number;                      // Cu wt%, anhydrous
    ni: number;                      // Ni wt%, anhydrous
    volatileTotal: number;           // Volatile content used
    rawTotal: number;                // Sum before normalization
}

/**
 * Compute volatile-free normalization for a single row.
 * Sums all major oxides + Fe(as FeO) + S + Cu + Ni + volatile
 * then renormalizes each to 100% volatile-free.
 */
export function computeAnhydrousNormalization(
    row: Record<string, any>,
    assignments: ColumnAssignments,
    volatileConfig: VolatileConfig,
    unitInfo: { sUnit: string; cuUnit: string; niUnit: string }
): AnhydrousResult {
    // Collect all oxide values
    const oxideValues: Record<string, number> = {};
    for (const oxide of RECALC_MAJOR_OXIDES) {
        const col = assignments.majorOxides[oxide];
        let value = safeNum(getNum(row, col || null));
        // Apply element-to-oxide conversion if this slot uses an element column
        const conv = assignments.oxideConversions?.[oxide];
        if (conv) {
            value = value * conv.unitConversionFactor * conv.elementToOxideFactor;
        }
        oxideValues[oxide] = value;
    }

    // Total Fe as FeO
    const feOT = getTotalFeAsFeO(row, assignments);

    // S, Cu, Ni — convert from ppm to wt% if needed
    let s = safeNum(getNum(row, assignments.sColumn));
    let cu = safeNum(getNum(row, assignments.cuColumn));
    let ni = safeNum(getNum(row, assignments.niColumn));

    if (unitInfo.sUnit === 'ppm') s *= UNIT_CONVERSIONS.ppm_to_wt_percent;
    if (unitInfo.cuUnit === 'ppm') cu *= UNIT_CONVERSIONS.ppm_to_wt_percent;
    if (unitInfo.niUnit === 'ppm') ni *= UNIT_CONVERSIONS.ppm_to_wt_percent;

    // Volatile total
    let volatileTotal = 0;
    if (volatileConfig.useLoiAsVolatile) {
        volatileTotal = safeNum(getNum(row, volatileConfig.loiColumn));
    } else {
        const h2o = safeNum(getNum(row, volatileConfig.h2oColumn));
        const co2 = safeNum(getNum(row, volatileConfig.co2Column));
        volatileTotal = h2o + co2;
    }

    // Sum everything
    const oxideSum = Object.values(oxideValues).reduce((a, b) => a + b, 0);
    const rawTotal = oxideSum + feOT + s + cu + ni + volatileTotal;

    // Normalization factor: scale to 100% volatile-free
    const anhydrousTotal = rawTotal - volatileTotal;
    const factor = anhydrousTotal > 0 ? 100 / anhydrousTotal : 1;

    // Renormalize
    const anhydrousOxides: Record<string, number> = {};
    for (const oxide of RECALC_MAJOR_OXIDES) {
        anhydrousOxides[oxide] = oxideValues[oxide] * factor;
    }

    return {
        oxides: anhydrousOxides,
        feOT: feOT * factor,
        s: s * factor,
        cu: cu * factor,
        ni: ni * factor,
        volatileTotal,
        rawTotal,
    };
}

// ============================================================================
// STEP 3: Fe2O3/FeO splitting via MgO-dependent ramp function
// ============================================================================

/**
 * Compute the Fe2O3/[FeO+Fe2O3] molar ratio using the MgO ramp function.
 *
 * Barnes formula:
 *   ratio = (MgO < high) * (MgO > low) * (R - R*(MgO-low)/(high-low)) + (MgO < low) * R
 *
 * Where R = liquidRatio (typically 0.1)
 *
 * This means:
 * - MgO >= high: ratio = 0 (pure adcumulate, all Fe as FeO)
 * - MgO <= low: ratio = R (pure liquid, 10% Fe as Fe2O3)
 * - Between: linear ramp from R to 0
 */
export function computeFeRamp(mgoAnhydrous: number, config: FeRampConfig): number {
    const { mgoLow, mgoHigh, liquidRatio } = config;

    if (mgoAnhydrous >= mgoHigh) return 0;
    if (mgoAnhydrous <= mgoLow) return liquidRatio;

    // Linear interpolation between low and high
    return liquidRatio * (1 - (mgoAnhydrous - mgoLow) / (mgoHigh - mgoLow));
}

/**
 * Split total Fe (as FeO wt%) into FeO and Fe2O3 using the molar ratio.
 *
 * The ratio is Fe2O3 / [FeO + Fe2O3] on a MOLAR basis.
 * We convert FeO total to moles, apply the ratio, then convert back to wt%.
 */
export function splitFeOFe2O3(
    feTotalAsFeO: number,
    fe2o3MolarRatio: number
): { feo: number; fe2o3: number } {
    if (fe2o3MolarRatio <= 0) {
        return { feo: feTotalAsFeO, fe2o3: 0 };
    }

    // Convert total FeO to moles of Fe
    const mwFeO = ATOMIC_WEIGHTS.Fe + ATOMIC_WEIGHTS.O;   // 71.844
    const mwFe2O3 = 2 * ATOMIC_WEIGHTS.Fe + 3 * ATOMIC_WEIGHTS.O; // 159.69

    const totalFeMoles = feTotalAsFeO / mwFeO;

    // fe2o3MolarRatio = moles_Fe2O3 / (moles_FeO + moles_Fe2O3)
    // Each mole of Fe2O3 contains 2 Fe atoms, each FeO contains 1
    // totalFeMoles = molesFeO_Fe + 2 * molesFe2O3_Fe
    // Let x = moles Fe2O3, y = moles FeO
    // ratio = x / (y + x)
    // totalFeMoles = y + 2x
    // From ratio: y = x * (1 - ratio) / ratio
    // totalFeMoles = x * (1 - ratio) / ratio + 2x = x * ((1-ratio)/ratio + 2) = x * (1-ratio + 2*ratio) / ratio = x * (1+ratio) / ratio
    // x = totalFeMoles * ratio / (1 + ratio)

    const molesFe2O3 = totalFeMoles * fe2o3MolarRatio / (1 + fe2o3MolarRatio);
    const molesFeO = totalFeMoles - 2 * molesFe2O3;

    const feo = Math.max(0, molesFeO * mwFeO);
    const fe2o3 = molesFe2O3 * mwFe2O3;

    return { feo, fe2o3 };
}

// ============================================================================
// STEP 4: Sulfide correction
// ============================================================================

/**
 * Compute sulfide correction for a single sample.
 *
 * Auto-selects Method 1 or Method 2 based on S content vs threshold:
 *
 * Method 1 (high S, > threshold):
 *   - Estimate Nisil from MgO relationship
 *   - Nisil = ({[MgO*100/siltotal] > 10} * {[MgO*100/siltotal] - 10} * 90) * (siltotal/100)
 *   - Fesul = {(S/32) - (Cu/63.5) * (1/SM) - (Ni-Nisil)/58.7} * 55.8
 *
 * Method 2 (low S, < threshold):
 *   - Assume Fe/Ni ratio in sulfide (FN parameter)
 *   - Fesul = (1/SM) * ((FN/(1+FN)) * S/32) * 55.8
 *   - Nisul = (1/SM) * ((1/FN) * S/32) * 58.7
 *   - Nisil = Ni_total - Nisul
 */
export function computeSulfideCorrection(
    anhydrous: AnhydrousResult,
    config: SulfideCorrectionConfig
): RecalculationSampleResult {
    const { sm, fn, sThreshold, silicateNiOverride } = config;
    const { feOT, s, cu, ni, volatileTotal } = anhydrous;
    const mgo = anhydrous.oxides['MgO'] || 0;

    // Silicate total (everything except S, Cu, Ni)
    const oxideSum = Object.values(anhydrous.oxides).reduce((a, b) => a + b, 0);
    const silTotal = oxideSum + feOT; // silicate fraction (oxides + FeO total)

    // Determine which method to use
    let useMethod: 1 | 2;
    if (config.method === 'auto') {
        useMethod = s > sThreshold ? 1 : 2;
    } else {
        useMethod = config.method === 'method1' ? 1 : 2;
    }

    // Atomic weights for stoichiometry
    const awS = ATOMIC_WEIGHTS.S;    // 32.065
    const awFe = ATOMIC_WEIGHTS.Fe;  // 55.845
    const awNi = ATOMIC_WEIGHTS.Ni;  // 58.693
    const awCu = ATOMIC_WEIGHTS.Cu;  // 63.546

    let niSilicate: number;
    let niSulfide: number;
    let feSulfide: number;

    if (useMethod === 1) {
        // Method 1: estimate silicate Ni from MgO relationship
        if (silicateNiOverride !== null) {
            // Convert override from ppm to wt%
            niSilicate = silicateNiOverride * UNIT_CONVERSIONS.ppm_to_wt_percent;
        } else {
            // Barnes formula for silicate Ni:
            // MgO_norm = MgO * 100 / silTotal
            const mgoNorm = silTotal > 0 ? (mgo * 100 / silTotal) : 0;
            // Nisil_ppm = max(0, mgoNorm - 10) * 90 (ppm in silicate)
            // Then scale back: Nisil_wt% = Nisil_ppm * silTotal / 100 / 10000
            const nisilPpm = Math.max(0, mgoNorm - 10) * 90;
            niSilicate = nisilPpm * (silTotal / 100) * UNIT_CONVERSIONS.ppm_to_wt_percent;
        }
        niSulfide = Math.max(0, ni - niSilicate);

        // Fesul = {(S/awS) - (Cu/awCu) * (1/SM) - (Ni-Nisil)/awNi} * awFe
        // Barnes: accounts for Cu occupying sites and Ni in sulfide
        feSulfide = ((s / awS) - (cu / awCu) * (1 / sm) - niSulfide / awNi) * awFe;
    } else {
        // Method 2: assume Fe/Ni molar ratio in sulfide
        // Fesul = (1/SM) * ((FN/(1+FN)) * S/awS) * awFe
        feSulfide = (1 / sm) * ((fn / (1 + fn)) * s / awS) * awFe;
        // Nisul = (1/SM) * ((1/FN) * S/awS) * awNi
        // Note: the (1/FN) here means the Ni fraction = 1/(FN+1) of moles, but the
        // Barnes formula as written uses 1/FN directly, partitioning the S moles
        // Actually: Nisul = (1/SM) * ((1/(FN+1)) * S/awS) * awNi
        // Let's match Barnes exactly: FN = Fe/Ni molar ratio
        // fraction of Fe in sulfide moles = FN/(1+FN), fraction of Ni = 1/(1+FN)
        niSulfide = (1 / sm) * ((1 / (fn + 1)) * s / awS) * awNi;
        niSilicate = Math.max(0, ni - niSulfide);
    }

    // Clamp feSulfide to non-negative (negative = bad SM assumption)
    if (feSulfide < 0) feSulfide = 0;

    // Sulfide mode: total sulfide mineral wt%
    // Sulfide = S + Fesul + Nisul + Cu
    const sulfideMode = s + feSulfide + niSulfide + cu;

    // Ni tenor: Ni in 100% sulfide
    let niTenor: number | null = null;
    if (sulfideMode > 0 && s > sThreshold) {
        niTenor = (niSulfide / sulfideMode) * 100;
        // Flag unrealistic values
        if (niTenor > 20) niTenor = null;
    }

    // Fe2O3/FeO ramp — compute here for completeness (used in step 4)
    const fe2o3Ratio = 0; // Placeholder, set by caller

    return {
        volatileTotal,
        anhydrousTotal: 100, // Already normalized to 100
        fe2o3Ratio,
        feoSilicate: 0,       // Set in sulfide-free normalization
        fe2o3Silicate: 0,     // Set in sulfide-free normalization
        sulfideMethod: useMethod,
        niSilicate,
        niSulfide,
        feSulfide,
        sulfideMode,
        niTenor,
    };
}

// ============================================================================
// STEP 5: Sulfide-free normalization with Fe splitting
// ============================================================================

export interface SulfideFreeResult {
    oxides: Record<string, number>; // Includes FeO_recalc and Fe2O3_recalc
    feo: number;
    fe2o3: number;
}

/**
 * Compute sulfide-free normalization.
 *
 * Subtracts sulfide Fe, Ni, Cu, S from anhydrous values.
 * Splits remaining Fe into FeO and Fe2O3 using the ramp ratio.
 * Renormalizes to 100%.
 */
export function computeSulfideFreeNormalization(
    anhydrous: AnhydrousResult,
    sampleResult: RecalculationSampleResult,
    fe2o3Ratio: number
): SulfideFreeResult {
    // Start with anhydrous oxide values
    const oxides: Record<string, number> = { ...anhydrous.oxides };

    // Subtract sulfide Fe from total FeO
    // FeO_silicate = FeOT_anhydrous - 1.2865 * Fesul
    // (1.2865 = FeO/Fe molar mass ratio = 71.844/55.845)
    const feoPerFe = (ATOMIC_WEIGHTS.Fe + ATOMIC_WEIGHTS.O) / ATOMIC_WEIGHTS.Fe;
    const feoSilicate = Math.max(0, anhydrous.feOT - sampleResult.feSulfide * feoPerFe);

    // Split silicate Fe into FeO and Fe2O3
    const { feo, fe2o3 } = splitFeOFe2O3(feoSilicate, fe2o3Ratio);

    // The silicate total without S, Cu, sulfide Ni, sulfide Fe
    // We already have the oxides; now remove the non-silicate components
    const silicateSum =
        Object.values(oxides).reduce((a, b) => a + b, 0) +
        feo + fe2o3; // Use split Fe instead of total FeO

    // Renormalize to 100%
    const factor = silicateSum > 0 ? 100 / silicateSum : 1;

    const result: Record<string, number> = {};
    for (const oxide of RECALC_MAJOR_OXIDES) {
        result[oxide] = (oxides[oxide] || 0) * factor;
    }

    return {
        oxides: result,
        feo: feo * factor,
        fe2o3: fe2o3 * factor,
    };
}

// ============================================================================
// MASTER FUNCTION: Execute full Barnes recalculation pipeline
// ============================================================================

/**
 * Detect unit for an element column from geochemMappings.
 */
function detectUnit(
    columnName: string | null,
    geochemMappings: Array<{ columnName: string; unit: string }>
): string {
    if (!columnName) return 'wt%';
    const mapping = geochemMappings.find(m => m.columnName === columnName);
    return mapping?.unit || 'wt%';
}

/**
 * Execute the full Barnes recalculation pipeline on the entire dataset.
 */
export function executeBarnesRecalculation(
    data: Record<string, any>[],
    config: RecalculationConfig,
    geochemMappings: Array<{ columnName: string; unit: string }>
): RecalculationResults {
    const { columnAssignments, volatileConfig, feRampConfig, sulfideConfig } = config;
    const warnings: string[] = [];

    // Detect units for S, Cu, Ni
    const unitInfo = {
        sUnit: detectUnit(columnAssignments.sColumn, geochemMappings),
        cuUnit: detectUnit(columnAssignments.cuColumn, geochemMappings),
        niUnit: detectUnit(columnAssignments.niColumn, geochemMappings),
    };

    // Check for sulfide correction capability
    const canDoSulfide = !!(columnAssignments.sColumn);
    if (!canDoSulfide) {
        warnings.push('Sulfur column not assigned — sulfide correction will be skipped.');
    }

    // Output arrays
    const anhydrousColumns: Record<string, number[]> = {};
    const recalculatedColumns: Record<string, number[]> = {};
    const diagnosticColumns: Record<string, (number | null)[]> = {};

    // Initialize output column arrays
    for (const oxide of RECALC_MAJOR_OXIDES) {
        anhydrousColumns[`${oxide}_anhyd`] = [];
        recalculatedColumns[`${oxide}_recalc`] = [];
    }
    anhydrousColumns['FeOT_anhyd'] = [];
    recalculatedColumns['FeO_recalc'] = [];
    recalculatedColumns['Fe2O3_recalc'] = [];

    diagnosticColumns['Sulfide_Mode_wt%'] = [];
    diagnosticColumns['Ni_Tenor'] = [];
    diagnosticColumns['Fe_Sulfide'] = [];
    diagnosticColumns['Ni_Silicate'] = [];
    diagnosticColumns['Ni_Sulfide'] = [];
    diagnosticColumns['Sulfide_Method'] = [];

    const sampleResults: RecalculationSampleResult[] = [];
    let negFeSulCount = 0;
    let highTenorCount = 0;
    let lowTotalCount = 0;
    let physicalLimitCount = 0;
    let highSulfideModeCount = 0;

    let incompleteRowCount = 0;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];

        // Check LOI filter
        if (volatileConfig.maxLoiFilter !== null && volatileConfig.useLoiAsVolatile) {
            const loi = getNum(row, volatileConfig.loiColumn);
            if (loi !== null && loi > volatileConfig.maxLoiFilter) {
                // Filtered out — push nulls
                pushNullRow(anhydrousColumns, recalculatedColumns, diagnosticColumns);
                sampleResults.push(createNullResult());
                continue;
            }
        }

        // Row completeness check: require SiO2 and Fe data for a meaningful recalculation.
        // Without these, normalizing to 100% inflates minor components (MnO, Cr2O3) unrealistically.
        const hasSiO2 = getNum(row, columnAssignments.majorOxides['SiO2'] || null) !== null;
        const hasFe = getNum(row, columnAssignments.feColumn) !== null ||
            (getNum(row, columnAssignments.feoColumn) !== null && getNum(row, columnAssignments.fe2o3Column) !== null);
        if (!hasSiO2 || !hasFe) {
            incompleteRowCount++;
            pushNullRow(anhydrousColumns, recalculatedColumns, diagnosticColumns);
            sampleResults.push(createNullResult());
            continue;
        }

        // Step 1: Anhydrous normalization
        const anhydrous = computeAnhydrousNormalization(row, columnAssignments, volatileConfig, unitInfo);

        // Filter 1: Low raw total — excludes incomplete analyses (missing LOI, etc.)
        if (anhydrous.rawTotal < MIN_RAW_TOTAL) {
            lowTotalCount++;
            pushNullRow(anhydrousColumns, recalculatedColumns, diagnosticColumns);
            sampleResults.push(createNullResult());
            continue;
        }

        // Push anhydrous values
        for (const oxide of RECALC_MAJOR_OXIDES) {
            anhydrousColumns[`${oxide}_anhyd`].push(anhydrous.oxides[oxide]);
        }
        anhydrousColumns['FeOT_anhyd'].push(anhydrous.feOT);

        // Step 2: Fe ramp
        const mgoAnhydrous = anhydrous.oxides['MgO'] || 0;
        const fe2o3Ratio = computeFeRamp(mgoAnhydrous, feRampConfig);

        if (canDoSulfide) {
            // Step 3: Sulfide correction
            const sampleResult = computeSulfideCorrection(anhydrous, sulfideConfig);

            // Track warnings — check raw value before clamping for accurate count
            const rawFeSul = computeRawFeSulfide(anhydrous, sulfideConfig, sampleResult.sulfideMethod);
            if (rawFeSul < 0) negFeSulCount++;

            if (sampleResult.niTenor !== null && sampleResult.niTenor > 20) highTenorCount++;

            // Step 4: Sulfide-free normalization
            const sulfideFree = computeSulfideFreeNormalization(anhydrous, sampleResult, fe2o3Ratio);

            // Update sample result with Fe split values
            sampleResult.fe2o3Ratio = fe2o3Ratio;
            sampleResult.feoSilicate = sulfideFree.feo;
            sampleResult.fe2o3Silicate = sulfideFree.fe2o3;

            // Filter 2: Physical limits and high sulfide mode
            const recalcMgO = sulfideFree.oxides['MgO'] || 0;
            const recalcFeOT = sulfideFree.feo + sulfideFree.fe2o3;
            if (recalcMgO > MAX_MGO_RECALC || recalcFeOT > MAX_FEOT_RECALC) {
                physicalLimitCount++;
                pushNullRecalcRow(recalculatedColumns);
            } else if (sampleResult.sulfideMode > MAX_SULFIDE_MODE) {
                highSulfideModeCount++;
                pushNullRecalcRow(recalculatedColumns);
            } else {
                // Push recalculated values
                for (const oxide of RECALC_MAJOR_OXIDES) {
                    recalculatedColumns[`${oxide}_recalc`].push(sulfideFree.oxides[oxide]);
                }
                recalculatedColumns['FeO_recalc'].push(sulfideFree.feo);
                recalculatedColumns['Fe2O3_recalc'].push(sulfideFree.fe2o3);
            }

            // Push diagnostics (always — still useful for filtered samples)
            diagnosticColumns['Sulfide_Mode_wt%'].push(sampleResult.sulfideMode);
            diagnosticColumns['Ni_Tenor'].push(sampleResult.niTenor);
            diagnosticColumns['Fe_Sulfide'].push(sampleResult.feSulfide);
            diagnosticColumns['Ni_Silicate'].push(sampleResult.niSilicate);
            diagnosticColumns['Ni_Sulfide'].push(sampleResult.niSulfide);
            diagnosticColumns['Sulfide_Method'].push(sampleResult.sulfideMethod);

            sampleResults.push(sampleResult);
        } else {
            // No sulfide correction — just split Fe and normalize
            const { feo, fe2o3 } = splitFeOFe2O3(anhydrous.feOT, fe2o3Ratio);
            const oxideSum = Object.values(anhydrous.oxides).reduce((a, b) => a + b, 0) + feo + fe2o3;
            const factor = oxideSum > 0 ? 100 / oxideSum : 1;

            // Filter 2: Physical limits (no sulfide mode check in this branch)
            const noSulMgO = (anhydrous.oxides['MgO'] || 0) * factor;
            const noSulFeOT = feo * factor + fe2o3 * factor;
            if (noSulMgO > MAX_MGO_RECALC || noSulFeOT > MAX_FEOT_RECALC) {
                physicalLimitCount++;
                pushNullRecalcRow(recalculatedColumns);
            } else {
                for (const oxide of RECALC_MAJOR_OXIDES) {
                    recalculatedColumns[`${oxide}_recalc`].push((anhydrous.oxides[oxide] || 0) * factor);
                }
                recalculatedColumns['FeO_recalc'].push(feo * factor);
                recalculatedColumns['Fe2O3_recalc'].push(fe2o3 * factor);
            }

            // No sulfide diagnostics
            diagnosticColumns['Sulfide_Mode_wt%'].push(null);
            diagnosticColumns['Ni_Tenor'].push(null);
            diagnosticColumns['Fe_Sulfide'].push(null);
            diagnosticColumns['Ni_Silicate'].push(null);
            diagnosticColumns['Ni_Sulfide'].push(null);
            diagnosticColumns['Sulfide_Method'].push(null);

            sampleResults.push(createNullResult());
        }
    }

    if (lowTotalCount > 0) {
        warnings.push(`${lowTotalCount} samples excluded — raw analytical total below ${MIN_RAW_TOTAL}%.`);
    }
    if (incompleteRowCount > 0) {
        warnings.push(`${incompleteRowCount} rows skipped — missing SiO2 or Fe data required for recalculation.`);
    }
    if (physicalLimitCount > 0) {
        warnings.push(`${physicalLimitCount} samples had recalculated oxides exceeding physical limits (MgO >${MAX_MGO_RECALC}% or FeOT >${MAX_FEOT_RECALC}%).`);
    }
    if (highSulfideModeCount > 0) {
        warnings.push(`${highSulfideModeCount} samples had sulfide mode >${MAX_SULFIDE_MODE}% — recalculated silicate composition excluded as unreliable.`);
    }
    if (negFeSulCount > 0) {
        warnings.push(`${negFeSulCount} samples had negative Fe-sulfide (clamped to 0) — consider adjusting SM parameter.`);
    }
    if (highTenorCount > 0) {
        warnings.push(`${highTenorCount} samples had Ni tenor > 20% (set to null as unrealistic).`);
    }

    return {
        anhydrousColumns,
        recalculatedColumns,
        diagnosticColumns,
        warnings,
        sampleResults,
    };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function computeRawFeSulfide(
    anhydrous: AnhydrousResult,
    config: SulfideCorrectionConfig,
    method: 1 | 2
): number {
    const { sm, fn } = config;
    const { s, cu, ni } = anhydrous;
    const mgo = anhydrous.oxides['MgO'] || 0;
    const awS = ATOMIC_WEIGHTS.S;
    const awFe = ATOMIC_WEIGHTS.Fe;
    const awNi = ATOMIC_WEIGHTS.Ni;
    const awCu = ATOMIC_WEIGHTS.Cu;

    if (method === 1) {
        const oxideSum = Object.values(anhydrous.oxides).reduce((a, b) => a + b, 0);
        const silTotal = oxideSum + anhydrous.feOT;
        const mgoNorm = silTotal > 0 ? (mgo * 100 / silTotal) : 0;
        const nisilPpm = Math.max(0, mgoNorm - 10) * 90;
        const niSilicate = nisilPpm * (silTotal / 100) * UNIT_CONVERSIONS.ppm_to_wt_percent;
        const niSulfide = Math.max(0, ni - niSilicate);
        return ((s / awS) - (cu / awCu) * (1 / sm) - niSulfide / awNi) * awFe;
    } else {
        return (1 / sm) * ((fn / (1 + fn)) * s / awS) * awFe;
    }
}

function pushNullRow(
    anhydrousColumns: Record<string, number[]>,
    recalculatedColumns: Record<string, number[]>,
    diagnosticColumns: Record<string, (number | null)[]>
): void {
    for (const key of Object.keys(anhydrousColumns)) {
        anhydrousColumns[key].push(0);
    }
    for (const key of Object.keys(recalculatedColumns)) {
        recalculatedColumns[key].push(0);
    }
    for (const key of Object.keys(diagnosticColumns)) {
        diagnosticColumns[key].push(null);
    }
}

/** Push zeros for recalculated columns only. Used by Filter 2 where anhydrous
 *  and diagnostic values are still valid and pushed separately. */
function pushNullRecalcRow(
    recalculatedColumns: Record<string, number[]>
): void {
    for (const key of Object.keys(recalculatedColumns)) {
        recalculatedColumns[key].push(0);
    }
}

function createNullResult(): RecalculationSampleResult {
    return {
        volatileTotal: 0,
        anhydrousTotal: 0,
        fe2o3Ratio: 0,
        feoSilicate: 0,
        fe2o3Silicate: 0,
        sulfideMethod: 2,
        niSilicate: 0,
        niSulfide: 0,
        feSulfide: 0,
        sulfideMode: 0,
        niTenor: null,
    };
}
