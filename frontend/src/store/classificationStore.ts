import { create } from 'zustand';
import { useCustomDiagramStore } from './customDiagramStore';
import { ClassificationDiagram, DiagramRenderOptions } from '../types/classificationDiagram';
import type { Diagram, DiagramLibrary } from '../types/diagram';
import { toLegacyDiagram } from '../utils/classification/legacyAdapter';
// The built-in library (data/classificationDiagrams.json, ~1.9 MB) is loaded
// lazily with a dynamic import so it stays out of the main bundle. Until it
// resolves the store holds only custom diagrams and `isLoaded` is false.

// Schema v3 library -> legacy shape for the current renderer/editor.
function processDiagrams(diagramData: unknown): ClassificationDiagram[] {
    const lib = diagramData as DiagramLibrary;
    v3Diagrams = lib.diagrams;
    v3ById = new Map();
    for (const d of lib.diagrams) {
        v3ById.set(d.id, d);
        for (const legacy of d.legacyIds ?? []) if (!v3ById.has(legacy)) v3ById.set(legacy, d);
    }
    return lib.diagrams.map(toLegacyDiagram).filter((d): d is ClassificationDiagram => d !== null);
}

/** Built-in diagrams in schema v3 (empty until the library loads). */
let v3Diagrams: Diagram[] = [];
let v3ById = new Map<string, Diagram>();

/** All built-in v3 diagrams (including built-ins such as Piper). */
export function getBuiltInDiagramsV3(): Diagram[] {
    return v3Diagrams;
}

/** Look up a built-in v3 diagram by current or legacy id. */
export function getDiagramV3(id: string): Diagram | undefined {
    return v3ById.get(id);
}

/** True if `d` is the diagram identified by `id` (current or legacy id). */
export function diagramMatchesId(d: ClassificationDiagram, id: string | null | undefined): boolean {
    return !!id && (d.id === id || !!d.legacyIds?.includes(id));
}

interface ClassificationState {
    // All available diagrams
    diagrams: ClassificationDiagram[];
    categories: string[];
    /** True once the built-in diagram library has been loaded */
    isLoaded: boolean;

    // Render options
    renderOptions: DiagramRenderOptions;

    // Search/filter
    searchQuery: string;
    selectedCategory: string | null;

    // Actions
    setRenderOptions: (options: Partial<DiagramRenderOptions>) => void;
    setSearchQuery: (query: string) => void;
    setSelectedCategory: (category: string | null) => void;

    // Custom diagram actions
    addCustomDiagram: (diagram: ClassificationDiagram) => void;
    removeCustomDiagram: (id: string) => void;
    refreshCustomDiagrams: () => void;

    // Getters
    getFilteredDiagrams: () => ClassificationDiagram[];
    getDiagramsByCategory: (category: string) => ClassificationDiagram[];
}

/** Custom diagrams are owned (and persisted) by customDiagramStore. */
function loadCustomDiagrams(): ClassificationDiagram[] {
    return useCustomDiagramStore.getState().diagrams;
}

/** Built-in diagrams; empty until the lazy library import resolves. */
let builtInDiagrams: ClassificationDiagram[] = [];

const categoriesOf = (diagrams: ClassificationDiagram[]) =>
    [...new Set(diagrams.map(d => d.category))].sort();

/** Built-ins first, then every other diagram (custom) not already present. */
function mergeWithBuiltIns(others: ClassificationDiagram[]): ClassificationDiagram[] {
    const ids = new Set(builtInDiagrams.map(d => d.id));
    return [...builtInDiagrams, ...others.filter(d => !ids.has(d.id))];
}

/** Number of built-in diagrams — a live binding, updated when the library loads. */
export let TOTAL_DIAGRAMS = 0;

let libraryPromise: Promise<void> | null = null;

/** Load the built-in diagram library (idempotent). */
export function ensureDiagramsLoaded(): Promise<void> {
    if (!libraryPromise) {
        libraryPromise = import('../data/classificationDiagrams.json')
            .then((mod) => {
                const data = (mod as any).default ?? mod;
                builtInDiagrams = processDiagrams(data);
                TOTAL_DIAGRAMS = builtInDiagrams.length;
                useClassificationStore.setState(state => {
                    const diagrams = mergeWithBuiltIns(state.diagrams);
                    return { diagrams, categories: categoriesOf(diagrams), isLoaded: true };
                });
            })
            .catch((err) => {
                libraryPromise = null;
                console.error('[classificationStore] Failed to load diagram library:', err);
            });
    }
    return libraryPromise;
}

export const useClassificationStore = create<ClassificationState>((set, get) => {
    const customDiagrams = loadCustomDiagrams();

    return {
        diagrams: customDiagrams,
        categories: categoriesOf(customDiagrams),
        isLoaded: false,


        renderOptions: {
            style: 'color',
            showLabels: true,
            showGrid: true,
            showData: true,
            fillOpacity: 0.2
        },

        searchQuery: '',
        selectedCategory: null,


        setRenderOptions: (options) => set(state => ({
            renderOptions: { ...state.renderOptions, ...options }
        })),

        setSearchQuery: (query) => set({ searchQuery: query }),

        setSelectedCategory: (category) => set({ selectedCategory: category }),

        addCustomDiagram: (diagram) => set(state => {
            const newDiagrams = [...state.diagrams, diagram];
            const newCategories = [...new Set(newDiagrams.map(d => d.category))].sort();
            return { diagrams: newDiagrams, categories: newCategories };
        }),

        removeCustomDiagram: (id) => set(state => {
            const newDiagrams = state.diagrams.filter(d => d.id !== id);
            const newCategories = [...new Set(newDiagrams.map(d => d.category))].sort();
            return { diagrams: newDiagrams, categories: newCategories };
        }),

        refreshCustomDiagrams: () => {
            const all = mergeWithBuiltIns(loadCustomDiagrams());
            set({ diagrams: all, categories: categoriesOf(all) });
        },


        getFilteredDiagrams: () => {
            const { diagrams, searchQuery, selectedCategory } = get();
            let filtered = diagrams;

            if (selectedCategory) {
                filtered = filtered.filter(d => d.category === selectedCategory);
            }

            if (searchQuery) {
                const query = searchQuery.toLowerCase();
                filtered = filtered.filter(d =>
                    d.name.toLowerCase().includes(query) ||
                    d.category.toLowerCase().includes(query) ||
                    (d.subCategory && d.subCategory.toLowerCase().includes(query))
                );
            }

            return filtered;
        },

        getDiagramsByCategory: (category) => {
            const { diagrams } = get();
            return diagrams.filter(d => d.category === category);
        }
    };
});

// Start loading the library as soon as the store module is used
ensureDiagramsLoaded();
