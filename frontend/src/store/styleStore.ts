import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { StyleTemplate } from '../types/styleTemplate';

export type ClassificationMethod = 'manual' | 'equal' | 'quantile' | 'jenks';
export type StyleAttribute = 'color' | 'shape' | 'size';

export interface StyleRange {
    min: number;
    max: number;
    label: string;
    color?: string;
    shape?: string;
    size?: number;
    visible?: boolean;
}

export interface CategoryStyle {
    value: string;
    label: string;
    color?: string;
    shape?: string;
    size?: number;
    visible?: boolean;
}

export interface StyleRule {
    field: string;
    attribute: StyleAttribute;
    type: 'numeric' | 'categorical';
    method?: ClassificationMethod;
    numClasses?: number;
    palette?: string;
    ranges?: StyleRange[];
    categories?: CategoryStyle[];
}

export interface CustomPalette {
    name: string;
    colors: string[];
}

export type EmphasisMode = 'none' | 'opacity' | 'size' | 'both';
export type EmphasisDirection = 'high' | 'low';

export interface EmphasisSettings {
    enabled: boolean;
    mode: EmphasisMode;
    field: string | null;
    direction: EmphasisDirection;
    intensity: number;
    threshold: number | null;
}

interface StyleState {
    styleRules: StyleRule[];
    customPalettes: CustomPalette[];
    savedTemplates: StyleTemplate[];
    globalOpacity: number;
    emphasis: EmphasisSettings;

    addStyleRule: (rule: StyleRule) => void;
    updateStyleRule: (field: string, attribute: StyleAttribute, updates: Partial<StyleRule>) => void;
    removeStyleRule: (field: string, attribute: StyleAttribute) => void;
    getStyleRule: (field: string, attribute: StyleAttribute) => StyleRule | undefined;
    clearAllStyles: () => void;
    toggleRangeVisibility: (field: string, attribute: StyleAttribute, rangeIndex: number) => void;
    toggleCategoryVisibility: (field: string, attribute: StyleAttribute, categoryIndex: number) => void;
    setAllRangesVisible: (field: string, attribute: StyleAttribute, visible: boolean) => void;
    setAllCategoriesVisible: (field: string, attribute: StyleAttribute, visible: boolean) => void;

    addCustomPalette: (palette: CustomPalette) => void;
    removeCustomPalette: (name: string) => void;
    getCustomPalette: (name: string) => CustomPalette | undefined;

    addTemplate: (template: StyleTemplate) => void;
    removeTemplate: (name: string) => void;
    getTemplate: (name: string) => StyleTemplate | undefined;
    importTemplates: (templates: StyleTemplate[]) => void;

    setGlobalOpacity: (opacity: number) => void;

    setEmphasisEnabled: (enabled: boolean) => void;
    setEmphasisMode: (mode: EmphasisMode) => void;
    setEmphasisField: (field: string | null) => void;
    setEmphasisDirection: (direction: EmphasisDirection) => void;
    setEmphasisIntensity: (intensity: number) => void;
    setEmphasisThreshold: (threshold: number | null) => void;
    updateEmphasis: (updates: Partial<EmphasisSettings>) => void;
}

const defaultEmphasis: EmphasisSettings = {
    enabled: false,
    mode: 'both',
    field: null,
    direction: 'high',
    intensity: 70,
    threshold: null,
};

export const useStyleStore = create<StyleState>()(
    persist(
        (set, get) => ({
            styleRules: [],
            customPalettes: [],
            savedTemplates: [],
            globalOpacity: 1.0,
            emphasis: defaultEmphasis,

            addStyleRule: (rule) => {
                set((state) => {
                    const filtered = state.styleRules.filter(
                        r => !(r.field === rule.field && r.attribute === rule.attribute)
                    );
                    return { styleRules: [...filtered, rule] };
                });
            },

            updateStyleRule: (field, attribute, updates) => {
                set((state) => ({
                    styleRules: state.styleRules.map(rule =>
                        rule.field === field && rule.attribute === attribute
                            ? { ...rule, ...updates }
                            : rule
                    )
                }));
            },

            removeStyleRule: (field, attribute) => {
                set((state) => ({
                    styleRules: state.styleRules.filter(
                        r => !(r.field === field && r.attribute === attribute)
                    )
                }));
            },

            getStyleRule: (field, attribute) => {
                return get().styleRules.find(
                    r => r.field === field && r.attribute === attribute
                );
            },

            clearAllStyles: () => {
                set({ styleRules: [] });
            },

            toggleRangeVisibility: (field, attribute, rangeIndex) => {
                set((state) => ({
                    styleRules: state.styleRules.map(rule => {
                        if (rule.field === field && rule.attribute === attribute && rule.ranges) {
                            const newRanges = [...rule.ranges];
                            if (newRanges[rangeIndex]) {
                                newRanges[rangeIndex] = {
                                    ...newRanges[rangeIndex],
                                    visible: newRanges[rangeIndex].visible === false ? true : false
                                };
                            }
                            return { ...rule, ranges: newRanges };
                        }
                        return rule;
                    })
                }));
            },

            toggleCategoryVisibility: (field, attribute, categoryIndex) => {
                set((state) => ({
                    styleRules: state.styleRules.map(rule => {
                        if (rule.field === field && rule.attribute === attribute && rule.categories) {
                            const newCategories = [...rule.categories];
                            if (newCategories[categoryIndex]) {
                                newCategories[categoryIndex] = {
                                    ...newCategories[categoryIndex],
                                    visible: newCategories[categoryIndex].visible === false ? true : false
                                };
                            }
                            return { ...rule, categories: newCategories };
                        }
                        return rule;
                    })
                }));
            },

            setAllRangesVisible: (field, attribute, visible) => {
                set((state) => ({
                    styleRules: state.styleRules.map(rule => {
                        if (rule.field === field && rule.attribute === attribute && rule.ranges) {
                            return {
                                ...rule,
                                ranges: rule.ranges.map(r => ({ ...r, visible }))
                            };
                        }
                        return rule;
                    })
                }));
            },

            setAllCategoriesVisible: (field, attribute, visible) => {
                set((state) => ({
                    styleRules: state.styleRules.map(rule => {
                        if (rule.field === field && rule.attribute === attribute && rule.categories) {
                            return {
                                ...rule,
                                categories: rule.categories.map(c => ({ ...c, visible }))
                            };
                        }
                        return rule;
                    })
                }));
            },

            addCustomPalette: (palette) => {
                set((state) => {
                    const filtered = state.customPalettes.filter(p => p.name !== palette.name);
                    return { customPalettes: [...filtered, palette] };
                });
            },

            removeCustomPalette: (name) => {
                set((state) => ({
                    customPalettes: state.customPalettes.filter(p => p.name !== name)
                }));
            },

            getCustomPalette: (name) => {
                return get().customPalettes.find(p => p.name === name);
            },

            addTemplate: (template) => {
                set((state) => {
                    const filtered = state.savedTemplates.filter(t => t.name !== template.name);
                    return { savedTemplates: [...filtered, template] };
                });
            },

            removeTemplate: (name) => {
                set((state) => ({
                    savedTemplates: state.savedTemplates.filter(t => t.name !== name)
                }));
            },

            getTemplate: (name) => {
                return get().savedTemplates.find(t => t.name === name);
            },

            importTemplates: (templates) => {
                set((state) => {
                    const existingNames = new Set(state.savedTemplates.map(t => t.name));
                    const newTemplates = templates.filter(t => !existingNames.has(t.name));
                    return { savedTemplates: [...state.savedTemplates, ...newTemplates] };
                });
            },

            setGlobalOpacity: (opacity) => {
                set({ globalOpacity: Math.max(0.1, Math.min(1.0, opacity)) });
            },

            setEmphasisEnabled: (enabled) => {
                set((state) => ({
                    emphasis: { ...state.emphasis, enabled }
                }));
            },

            setEmphasisMode: (mode) => {
                set((state) => ({
                    emphasis: { ...state.emphasis, mode }
                }));
            },

            setEmphasisField: (field) => {
                set((state) => ({
                    emphasis: { ...state.emphasis, field }
                }));
            },

            setEmphasisDirection: (direction) => {
                set((state) => ({
                    emphasis: { ...state.emphasis, direction }
                }));
            },

            setEmphasisIntensity: (intensity) => {
                set((state) => ({
                    emphasis: { ...state.emphasis, intensity: Math.max(0, Math.min(100, intensity)) }
                }));
            },

            setEmphasisThreshold: (threshold) => {
                set((state) => ({
                    emphasis: { ...state.emphasis, threshold }
                }));
            },

            updateEmphasis: (updates) => {
                set((state) => ({
                    emphasis: { ...state.emphasis, ...updates }
                }));
            }
        }),
        {
            name: 'style-storage',
            version: 5
        }
    )
);

export function getStyleForValue(
    value: any,
    field: string,
    attribute: StyleAttribute,
    styleRules: StyleRule[]
): string | number | undefined {
    const rule = styleRules.find(r => r.field === field && r.attribute === attribute);
    if (!rule) return undefined;

    if (rule.type === 'numeric' && typeof value === 'number' && rule.ranges) {
        const range = rule.ranges.find(r => value >= r.min && value <= r.max);
        if (range && range.visible !== false) {
            if (attribute === 'color') return range.color;
            if (attribute === 'shape') return range.shape;
            if (attribute === 'size') return range.size;
        }
    } else if (rule.type === 'categorical' && rule.categories) {
        const category = rule.categories.find(c => c.value === String(value));
        if (category && category.visible !== false) {
            if (attribute === 'color') return category.color;
            if (attribute === 'shape') return category.shape;
            if (attribute === 'size') return category.size;
        }
    }

    return undefined;
}

export const MARKER_SHAPES = [
    { value: 'circle', label: 'Circle', symbol: 0 },
    { value: 'square', label: 'Square', symbol: 1 },
    { value: 'diamond', label: 'Diamond', symbol: 2 },
    { value: 'cross', label: 'Cross', symbol: 3 },
    { value: 'x', label: 'X', symbol: 4 },
    { value: 'triangle-up', label: 'Triangle Up', symbol: 5 },
    { value: 'triangle-down', label: 'Triangle Down', symbol: 6 },
    { value: 'pentagon', label: 'Pentagon', symbol: 15 },
    { value: 'hexagon', label: 'Hexagon', symbol: 18 },
    { value: 'star', label: 'Star', symbol: 17 },
    { value: 'hourglass', label: 'Hourglass', symbol: 21 },
];
