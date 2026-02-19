/**
 * Barnes Recalculation Wizard Store
 *
 * Manages wizard state, configuration, and execution for the
 * Barnes (2023) whole-rock geochemical recalculation workflow.
 */

import { create } from 'zustand';
import { ColumnGeochemMapping } from '../types/associations';
import {
    RecalculationConfig,
    ColumnAssignments,
    VolatileConfig,
    FeRampConfig,
    SulfideCorrectionConfig,
    RecalculationResults,
    OxideConversionInfo,
    DEFAULT_RECALCULATION_CONFIG,
    SUITE_PRESETS,
    RECALC_MAJOR_OXIDES,
} from '../types/recalculation';
import { executeBarnesRecalculation } from '../utils/calculations/barnesRecalculation';
import {
    findColumnForOxide,
    findColumnForElement,
    OXIDE_MAPPINGS,
} from '../utils/calculations/elementNameNormalizer';
import { ELEMENT_OXIDE_CONVERSIONS, UNIT_CONVERSIONS } from '../utils/calculations/constants';

interface RecalculationState {
    // Wizard navigation
    activeStep: number;

    // Configuration
    config: RecalculationConfig;

    // Results
    isProcessing: boolean;
    error: string | null;
    results: RecalculationResults | null;
    hasExecuted: boolean;

    // Actions
    setActiveStep: (step: number) => void;
    updateConfig: (partial: Partial<RecalculationConfig>) => void;
    updateColumnAssignments: (partial: Partial<ColumnAssignments>) => void;
    updateVolatileConfig: (partial: Partial<VolatileConfig>) => void;
    updateFeRampConfig: (partial: Partial<FeRampConfig>) => void;
    updateSulfideConfig: (partial: Partial<SulfideCorrectionConfig>) => void;

    // Auto-detect columns from geochemMappings
    autoDetectColumns: (mappings: ColumnGeochemMapping[]) => void;

    // Execute
    executeRecalculation: (data: Record<string, any>[], geochemMappings: ColumnGeochemMapping[]) => void;

    // Reset
    reset: () => void;
}

export const useRecalculationStore = create<RecalculationState>()((set, get) => ({
    activeStep: 0,
    config: { ...DEFAULT_RECALCULATION_CONFIG, columnAssignments: { ...DEFAULT_RECALCULATION_CONFIG.columnAssignments, majorOxides: {}, oxideConversions: {} } },
    isProcessing: false,
    error: null,
    results: null,
    hasExecuted: false,

    setActiveStep: (step) => set({ activeStep: step }),

    updateConfig: (partial) => set((state) => ({
        config: { ...state.config, ...partial },
    })),

    updateColumnAssignments: (partial) => set((state) => ({
        config: {
            ...state.config,
            columnAssignments: { ...state.config.columnAssignments, ...partial },
        },
    })),

    updateVolatileConfig: (partial) => set((state) => ({
        config: {
            ...state.config,
            volatileConfig: { ...state.config.volatileConfig, ...partial },
        },
    })),

    updateFeRampConfig: (partial) => set((state) => {
        const updated = { ...state.config.feRampConfig, ...partial };
        // If suiteType changed, apply preset values
        if (partial.suiteType && partial.suiteType !== state.config.feRampConfig.suiteType) {
            const preset = SUITE_PRESETS[partial.suiteType];
            updated.mgoLow = preset.mgoLow;
            updated.mgoHigh = preset.mgoHigh;
            updated.liquidRatio = preset.liquidRatio;
        }
        return {
            config: {
                ...state.config,
                feRampConfig: updated,
            },
        };
    }),

    updateSulfideConfig: (partial) => set((state) => ({
        config: {
            ...state.config,
            sulfideConfig: { ...state.config.sulfideConfig, ...partial },
        },
    })),

    autoDetectColumns: (mappings) => {
        const majorOxides: Record<string, string> = {};
        const oxideConversions: Record<string, OxideConversionInfo> = {};

        // Auto-detect major oxides
        for (const oxide of RECALC_MAJOR_OXIDES) {
            // Strategy 1: Direct oxide formula match via mappings
            let col = findColumnForOxide(mappings, oxide);

            // Strategy 2: Find by element with pct unit and matching oxide in column name
            if (!col) {
                const element = OXIDE_MAPPINGS[oxide];
                if (element) {
                    const match = mappings.find(m => {
                        if (m.isExcluded) return false;
                        const el = m.userOverride ?? m.detectedElement;
                        if (el !== element) return false;
                        const unit = m.userUnit ?? m.detectedUnit;
                        if (unit !== 'pct') return false;
                        // Verify column name contains the oxide pattern
                        return m.originalName.toLowerCase().includes(oxide.toLowerCase());
                    });
                    col = match?.originalName ?? null;
                }
            }

            // Strategy 3: Regex pattern matching on column name
            if (!col) {
                const oxideLC = oxide.toLowerCase();
                const match = mappings.find(m =>
                    !m.isExcluded && m.originalName.toLowerCase().startsWith(oxideLC)
                );
                col = match?.originalName ?? null;
            }

            // Strategy 4: Element fallback — find element column (any unit) and convert on-the-fly
            if (!col) {
                const element = OXIDE_MAPPINGS[oxide];
                if (element) {
                    const elementMatch = mappings.find(m => {
                        if (m.isExcluded) return false;
                        const el = m.userOverride ?? m.detectedElement;
                        return el === element;
                    });
                    if (elementMatch) {
                        const convFactor = ELEMENT_OXIDE_CONVERSIONS.find(
                            c => c.element === element && c.oxide === oxide
                        );
                        if (convFactor) {
                            const sourceUnit = elementMatch.userUnit ?? elementMatch.detectedUnit ?? 'ppm';
                            const unitFactor = sourceUnit === 'ppm'
                                ? UNIT_CONVERSIONS.ppm_to_wt_percent
                                : sourceUnit === 'ppb'
                                    ? UNIT_CONVERSIONS.ppb_to_wt_percent
                                    : 1.0; // pct/wt% already in correct units
                            oxideConversions[oxide] = {
                                element,
                                sourceUnit,
                                targetOxide: oxide,
                                elementToOxideFactor: convFactor.elementToOxide,
                                unitConversionFactor: unitFactor,
                            };
                            col = elementMatch.originalName;
                        }
                    }
                }
            }

            if (col) {
                majorOxides[oxide] = col;
            }
        }

        // Detect Fe columns
        let feColumn: string | null = null;
        let feColumnForm: 'FeOT' | 'Fe2O3T' | 'Fe2O3' | 'FeO' = 'FeOT';
        let feoColumn: string | null = null;
        let fe2o3Column: string | null = null;

        // Look for total Fe first
        const feotCol = findColumnForOxide(mappings, 'FeOT');
        const fe2o3tCol = findColumnForOxide(mappings, 'Fe2O3T');
        const fe2o3Col = findColumnForOxide(mappings, 'Fe2O3');
        const feoCol = findColumnForOxide(mappings, 'FeO');

        if (feotCol) {
            feColumn = feotCol;
            feColumnForm = 'FeOT';
        } else if (fe2o3tCol) {
            feColumn = fe2o3tCol;
            feColumnForm = 'Fe2O3T';
        } else if (fe2o3Col && feoCol) {
            // Both separate columns available
            feoColumn = feoCol;
            fe2o3Column = fe2o3Col;
            feColumn = fe2o3Col; // Set a default
            feColumnForm = 'Fe2O3';
        } else if (fe2o3Col) {
            feColumn = fe2o3Col;
            feColumnForm = 'Fe2O3';
        } else if (feoCol) {
            feColumn = feoCol;
            feColumnForm = 'FeO';
        }

        // Fallback: find Fe in element form if no oxide form found
        if (!feColumn && !feoColumn && !fe2o3Column) {
            const feElementCol = findColumnForElement(mappings, 'Fe', 'pct');
            if (feElementCol) {
                feColumn = feElementCol;
                const feMapping = mappings.find(m => m.originalName === feElementCol);
                if (feMapping?.oxideFormula === 'Fe2O3') {
                    feColumnForm = 'Fe2O3';
                } else if (feMapping?.oxideFormula === 'FeO') {
                    feColumnForm = 'FeO';
                } else {
                    // Element form - default to Fe2O3T as most common reporting
                    feColumnForm = 'Fe2O3T';
                }
            }
        }

        // Detect S, Cu, Ni
        const sColumn = findColumnForElement(mappings, 'S') || findColumnForOxide(mappings, 'S');
        const cuColumn = findColumnForElement(mappings, 'Cu');
        const niColumn = findColumnForElement(mappings, 'Ni');

        // Detect volatiles
        const loiCol = mappings.find(m =>
            m.originalName.toLowerCase().includes('loi') ||
            m.originalName.toLowerCase().includes('loss')
        )?.originalName || null;
        const h2oCol = findColumnForOxide(mappings, 'H2O') ||
            mappings.find(m => m.originalName.toLowerCase().includes('h2o'))?.originalName || null;
        const co2Col = findColumnForOxide(mappings, 'CO2') ||
            mappings.find(m => m.originalName.toLowerCase().includes('co2'))?.originalName || null;

        set((state) => ({
            config: {
                ...state.config,
                columnAssignments: {
                    majorOxides,
                    oxideConversions,
                    feColumn,
                    feColumnForm,
                    feoColumn,
                    fe2o3Column,
                    sColumn,
                    cuColumn,
                    niColumn,
                    loiColumn: loiCol,
                    h2oColumn: h2oCol,
                    co2Column: co2Col,
                },
                volatileConfig: {
                    ...state.config.volatileConfig,
                    loiColumn: loiCol,
                    h2oColumn: h2oCol,
                    co2Column: co2Col,
                    useLoiAsVolatile: !!loiCol,
                },
            },
        }));
    },

    executeRecalculation: (data, geochemMappings) => {
        set({ isProcessing: true, error: null });

        try {
            const config = get().config;
            // Map ColumnGeochemMapping to the format expected by the calculation engine
            const mappingInfo = geochemMappings.map(m => ({
                columnName: m.originalName,
                unit: m.userUnit || m.detectedUnit || 'wt%',
            }));
            const results = executeBarnesRecalculation(data, config, mappingInfo);
            set({
                results,
                hasExecuted: true,
                isProcessing: false,
            });
        } catch (err: any) {
            set({
                error: err.message || 'Recalculation failed',
                isProcessing: false,
            });
        }
    },

    reset: () => set({
        activeStep: 0,
        config: { ...DEFAULT_RECALCULATION_CONFIG, columnAssignments: { ...DEFAULT_RECALCULATION_CONFIG.columnAssignments, majorOxides: {}, oxideConversions: {} } },
        isProcessing: false,
        error: null,
        results: null,
        hasExecuted: false,
    }),
}));
