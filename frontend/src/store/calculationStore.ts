import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
    CalculationDefinition,
    CalculationConfig,
    QueuedCalculation,
    CalculationResult,
    SavedCalculation,
    ColumnMapping,
} from '../types/calculations';
import {
    getAllCalculationDefinitions,
    evaluateFormula,
    parseNumericValue,
    validateData,
} from '../utils/calculations';
import { useAppStore, getDatasetRows } from './appStore';
import { useAuditStore } from './auditStore';
import type { ColumnGeochemMapping } from '../types/associations';
import { findColumnForElement, findColumnForOxide, OXIDE_MAPPINGS } from '../utils/calculations/elementNameNormalizer';
import { unitToPpmFactor } from '../utils/calculations/elementColumnResolver';

interface CalculationState {
    // Available calculations
    builtInCalculations: CalculationDefinition[];
    customCalculations: CalculationDefinition[];

    // Calculation queue
    queue: QueuedCalculation[];

    // Results history
    results: CalculationResult[];

    // Saved calculation templates
    savedCalculations: SavedCalculation[];

    // UI State
    isCalculationManagerOpen: boolean;
    selectedCategory: string | null;
    selectedCalculationId: string | null;

    // Actions
    openCalculationManager: () => void;
    closeCalculationManager: () => void;
    setSelectedCategory: (category: string | null) => void;
    setSelectedCalculation: (id: string | null) => void;

    // Queue management
    addToQueue: (config: CalculationConfig) => void;
    removeFromQueue: (id: string) => void;
    clearQueue: () => void;
    updateQueueItem: (id: string, updates: Partial<QueuedCalculation>) => void;

    // Execute calculations
    executeCalculation: (queueId: string) => Promise<CalculationResult | null>;
    executeAllCalculations: () => Promise<CalculationResult[]>;

    // Custom calculations
    addCustomCalculation: (calc: CalculationDefinition) => void;
    removeCustomCalculation: (id: string) => void;

    // Saved templates
    saveCalculationTemplate: (name: string, config: CalculationConfig, description?: string) => void;
    removeSavedCalculation: (id: string) => void;
    loadSavedCalculation: (id: string) => CalculationConfig | null;

    // Auto-detect column mappings
    autoDetectMappings: (calculationId: string, columns: string[]) => ColumnMapping[];

    // Initialize built-in calculations
    initializeCalculations: () => void;
}

/**
 * Map a calculation input named like an element ("La") or oxide ("SiO2") to
 * a dataset column via the geochem mappings, with the factor that converts
 * the column's unit to the input's unit (ppm / ppb / wt%).
 */
function resolveInputColumn(
    inputName: string,
    inputUnit: string,
    mappings: ColumnGeochemMapping[],
): { columnName: string; conversionFactor?: number } | null {
    const oxideCol = OXIDE_MAPPINGS[inputName] !== undefined ? findColumnForOxide(mappings, inputName) : null;
    const column = oxideCol ?? findColumnForElement(mappings, inputName);
    if (!column) return null;

    const m = mappings.find(x => x.originalName === column);
    const toPpm = unitToPpmFactor(m?.userUnit ?? m?.detectedUnit);
    const inputToPpm = inputUnit === 'wt%' ? 1e4 : unitToPpmFactor(inputUnit);
    if (toPpm === null || inputToPpm === null) return { columnName: column };
    const factor = toPpm / inputToPpm;
    return factor === 1 ? { columnName: column } : { columnName: column, conversionFactor: factor };
}

// Generate unique ID
const generateId =() => `calc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const useCalculationStore = create<CalculationState>()(
    persist(
        (set, get) => ({
            builtInCalculations: [],
            customCalculations: [],
            queue: [],
            results: [],
            savedCalculations: [],
            isCalculationManagerOpen: false,
            selectedCategory: null,
            selectedCalculationId: null,

            initializeCalculations: () => {
                const builtIn = getAllCalculationDefinitions();
                set({ builtInCalculations: builtIn });
            },

            openCalculationManager: () => set({ isCalculationManagerOpen: true }),
            closeCalculationManager: () => set({ isCalculationManagerOpen: false }),

            setSelectedCategory: (category) => set({ selectedCategory: category }),
            setSelectedCalculation: (id) => set({ selectedCalculationId: id }),

            addToQueue: (config) => {
                const queueItem: QueuedCalculation = {
                    id: generateId(),
                    config,
                    status: 'pending',
                };
                set((state) => ({ queue: [...state.queue, queueItem] }));
            },

            removeFromQueue: (id) => {
                set((state) => ({
                    queue: state.queue.filter((item) => item.id !== id),
                }));
            },

            clearQueue: () => set({ queue: [] }),

            updateQueueItem: (id, updates) => {
                set((state) => ({
                    queue: state.queue.map((item) =>
                        item.id === id ? { ...item, ...updates } : item
                    ),
                }));
            },

            executeCalculation: async (queueId) => {
                const state = get();
                const queueItem = state.queue.find((q) => q.id === queueId);
                if (!queueItem) return null;

                // Update status to running
                get().updateQueueItem(queueId, { status: 'running' });

                try {
                    // Get the calculation definition
                    const allCalcs = [...state.builtInCalculations, ...state.customCalculations];
                    const calcDef = allCalcs.find((c) => c.id === queueItem.config.calculationId);

                    if (!calcDef) {
                        throw new Error(`Calculation not found: ${queueItem.config.calculationId}`);
                    }

                    // Get data from app store
                    const appState = useAppStore.getState();
                    const data = getDatasetRows();

                    if (!data || data.length === 0) {
                        throw new Error('No data available');
                    }

                    // Execute the calculation
                    const values: (number | null)[] = [];

                    for (const row of data) {
                        // Build inputs from column mappings
                        const inputs: Record<string, number | null> = {};

                        for (const mapping of queueItem.config.columnMappings) {
                            let value = parseNumericValue(row[mapping.columnName]);

                            // Apply conversion factor if specified
                            if (value !== null && mapping.conversionFactor) {
                                value = value * mapping.conversionFactor;
                            }

                            // Handle missing values
                            if (value === null) {
                                switch (queueItem.config.missingValueStrategy) {
                                    case 'zero':
                                        value = 0;
                                        break;
                                    case 'default':
                                        value = queueItem.config.defaultValue ?? null;
                                        break;
                                    case 'half-dl':
                                        // Already handled in parseNumericValue for <X values
                                        break;
                                    case 'skip':
                                    default:
                                        // Leave as null
                                        break;
                                }
                            }

                            inputs[mapping.inputName] = value;
                        }

                        // Calculate result
                        let result: number | null = null;

                        if (calcDef.calculateFn) {
                            result = calcDef.calculateFn(inputs, row);
                        } else if (calcDef.formula) {
                            result = evaluateFormula(calcDef.formula, inputs);
                        }

                        values.push(result);
                    }

                    // Validate results
                    const validation = validateData(values, calcDef.validationRules, data);

                    // Create result object
                    const calcResult: CalculationResult = {
                        success: true,
                        columnName: queueItem.config.outputColumnName,
                        values,
                        validation,
                        calculationId: calcDef.id,
                        timestamp: new Date().toISOString(),
                    };

                    // Add calculated column via the store action so the columnar copy stays in sync
                    const outName = queueItem.config.outputColumnName;
                    const existingColumn = appState.columns.find((c) => c.name === outName);
                    appState.addColumn(
                        outName,
                        values,
                        'numeric',
                        existingColumn?.role ?? 'Calculated',
                        existingColumn?.transformationType ?? null,
                        undefined,
                        {
                            kind: 'calculation',
                            description: calcDef.name,
                            params: {
                                calculationId: calcDef.id,
                                columnMappings: queueItem.config.columnMappings,
                                missingValueStrategy: queueItem.config.missingValueStrategy,
                            },
                            created: new Date().toISOString(),
                        },
                    );

                    // Update queue status
                    const status = validation.errors.length > 0 ? 'warning' : 'completed';
                    get().updateQueueItem(queueId, {
                        status,
                        warningMessage: validation.warnings.length > 0
                            ? `${validation.warnings.length} warnings`
                            : undefined,
                    });

                    // Add to results
                    set((state) => ({
                        results: [...state.results, calcResult],
                    }));

                    // Record audit
                    useAuditStore.getState().recordAudit({
                        category: 'calculation',
                        operation: calcDef.name || 'Custom Calculation',
                        description: `Executed calculation "${calcDef.name || queueItem.config.calculationId}" → column "${queueItem.config.outputColumnName}"`,
                        mathFormula: calcDef.formulaDisplay || undefined,
                        reference: (calcDef as any).reference || undefined,
                        parameters: {
                            missingValueStrategy: queueItem.config.missingValueStrategy,
                            columnMappings: queueItem.config.columnMappings.map((m: ColumnMapping) => ({ input: m.inputName, column: m.columnName })),
                        },
                        inputColumns: queueItem.config.columnMappings.map((m: ColumnMapping) => m.columnName),
                        outputColumns: [queueItem.config.outputColumnName],
                        rowsAffected: data.length,
                    });

                    return calcResult;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    get().updateQueueItem(queueId, {
                        status: 'error',
                        errorMessage,
                    });
                    return null;
                }
            },

            executeAllCalculations: async () => {
                const state = get();
                const pendingItems = state.queue.filter((q) => q.status === 'pending');
                const results: CalculationResult[] = [];

                for (const item of pendingItems) {
                    const result = await get().executeCalculation(item.id);
                    if (result) {
                        results.push(result);
                    }
                }

                return results;
            },

            addCustomCalculation: (calc) => {
                set((state) => ({
                    customCalculations: [...state.customCalculations, calc],
                }));
            },

            removeCustomCalculation: (id) => {
                set((state) => ({
                    customCalculations: state.customCalculations.filter((c) => c.id !== id),
                }));
            },

            saveCalculationTemplate: (name, config, description) => {
                const saved: SavedCalculation = {
                    id: generateId(),
                    name,
                    config,
                    createdAt: new Date().toISOString(),
                    description,
                };
                set((state) => ({
                    savedCalculations: [...state.savedCalculations, saved],
                }));
            },

            removeSavedCalculation: (id) => {
                set((state) => ({
                    savedCalculations: state.savedCalculations.filter((s) => s.id !== id),
                }));
            },

            loadSavedCalculation: (id) => {
                const state = get();
                const saved = state.savedCalculations.find((s) => s.id === id);
                return saved?.config || null;
            },

            autoDetectMappings: (calculationId, columns) => {
                const state = get();
                const allCalcs = [...state.builtInCalculations, ...state.customCalculations];
                const calcDef = allCalcs.find((c) => c.id === calculationId);

                if (!calcDef) return [];

                const mappings: ColumnMapping[] = [];

                const geochemMappings = useAppStore.getState().geochemMappings;
                const available = new Set(columns);

                for (const input of calcDef.inputs) {
                    let matchedColumn: string | null = null;

                    // Element/oxide inputs: resolve through the geochem mappings
                    // (unit-aware: prefers ppm, converts pct/ppb to the input's unit)
                    const viaMapping = resolveInputColumn(input.name, input.unit, geochemMappings);
                    if (viaMapping && available.has(viaMapping.columnName)) {
                        mappings.push({ inputName: input.name, ...viaMapping });
                        continue;
                    }

                    // Try exact alias match first
                    for (const alias of input.aliases) {
                        const match = columns.find(
                            (col) => col.toLowerCase() === alias.toLowerCase()
                        );
                        if (match) {
                            matchedColumn = match;
                            break;
                        }
                    }

                    // Try pattern match
                    if (!matchedColumn) {
                        for (const pattern of input.patterns) {
                            const match = columns.find((col) => pattern.test(col));
                            if (match) {
                                matchedColumn = match;
                                break;
                            }
                        }
                    }

                    // (No substring fallback: "K" would match any column containing
                    // a k, "La" would match "Latitude".)

                    mappings.push({
                        inputName: input.name,
                        columnName: matchedColumn || '',
                    });
                }

                return mappings;
            },
        }),
        {
            name: 'calculation-storage',
            version: 1,
            partialize: (state) => ({
                customCalculations: state.customCalculations,
                savedCalculations: state.savedCalculations,
            }),
        }
    )
);

// Initialize calculations on store creation
useCalculationStore.getState().initializeCalculations();
