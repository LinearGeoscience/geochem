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
import { useAppStore } from './appStore';

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

// Generate unique ID
const generateId = () => `calc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

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
                    const data = appState.data;

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

                    // Add calculated column to data
                    const newData = data.map((row, index) => ({
                        ...row,
                        [queueItem.config.outputColumnName]: values[index],
                    }));

                    // Check if column already exists
                    const existingColumn = appState.columns.find(
                        (c) => c.name === queueItem.config.outputColumnName
                    );

                    const newColumns = existingColumn
                        ? appState.columns
                        : [
                            ...appState.columns,
                            {
                                name: queueItem.config.outputColumnName,
                                type: 'numeric' as const,
                                role: 'Calculated' as string | null,
                                alias: queueItem.config.outputColumnName,
                            },
                        ];

                    // Update app store
                    useAppStore.setState({
                        data: newData,
                        columns: newColumns,
                    });

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

                for (const input of calcDef.inputs) {
                    let matchedColumn: string | null = null;

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

                    // Try fuzzy match (contains)
                    if (!matchedColumn) {
                        const inputLower = input.name.toLowerCase();
                        const match = columns.find(
                            (col) =>
                                col.toLowerCase().includes(inputLower) ||
                                inputLower.includes(col.toLowerCase())
                        );
                        if (match) {
                            matchedColumn = match;
                        }
                    }

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
