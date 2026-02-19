import { create } from 'zustand';
import diagramData from '../data/classificationDiagrams.json';
import {
    ClassificationDiagram,
    DiagramRenderOptions,
    DiagramVariable,
    DiagramLine,
    DiagramPointFeature,
    DiagramLabel,
    DiagramBounds
} from '../types/classificationDiagram';
// Custom diagrams loaded directly from localStorage via loadCustomDiagrams()

// Transform raw JSON data to typed diagrams
interface RawDiagram {
    id: string;
    name: string;
    type: 'ternary' | 'xy';
    category: string;
    subCategory?: string;
    axes: {
        a?: { name: string; formula?: string; log?: boolean };
        b?: { name: string; formula?: string; log?: boolean };
        c?: { name: string; formula?: string; log?: boolean };
        x?: { name: string; formula?: string; log?: boolean };
        y?: { name: string; formula?: string; log?: boolean };
    };
    polygons: {
        name: string;
        color: { r: number; g: number; b: number };
        points: { x: number; y: number }[];
        labelPos?: { x: number; y: number } | { a: number; b: number };
        labelAngle?: number;
        visible?: boolean;
        closed?: boolean;
    }[];
    variables?: DiagramVariable[];
    lines?: DiagramLine[];
    pointFeatures?: DiagramPointFeature[];
    labels?: DiagramLabel[];
    bounds?: DiagramBounds;
    comments?: string[];
    references?: string[];
}

// Process diagrams from JSON
function loadDiagrams(): ClassificationDiagram[] {
    const rawDiagrams = (diagramData as any).diagrams as RawDiagram[];

    return rawDiagrams.map(raw => ({
        id: raw.id,
        name: raw.name,
        type: raw.type,
        category: raw.category,
        subCategory: raw.subCategory,
        axes: raw.axes,
        variables: raw.variables,
        polygons: raw.polygons.map(p => ({
            name: p.name,
            color: p.color,
            points: p.points,
            labelPos: p.labelPos,
            labelAngle: p.labelAngle,
            visible: p.visible !== false,
            ...(p.closed === false ? { closed: false } : {})
        })),
        lines: raw.lines,
        pointFeatures: raw.pointFeatures,
        labels: raw.labels,
        bounds: raw.bounds,
        comments: raw.comments,
        references: raw.references
    }));
}

interface ClassificationState {
    // All available diagrams
    diagrams: ClassificationDiagram[];
    categories: string[];

    // Currently selected diagram
    selectedDiagramId: string | null;

    // Render options
    renderOptions: DiagramRenderOptions;

    // Search/filter
    searchQuery: string;
    selectedCategory: string | null;

    // Actions
    setSelectedDiagram: (id: string | null) => void;
    setRenderOptions: (options: Partial<DiagramRenderOptions>) => void;
    setSearchQuery: (query: string) => void;
    setSelectedCategory: (category: string | null) => void;

    // Custom diagram actions
    addCustomDiagram: (diagram: ClassificationDiagram) => void;
    removeCustomDiagram: (id: string) => void;
    refreshCustomDiagrams: () => void;

    // Getters
    getSelectedDiagram: () => ClassificationDiagram | null;
    getFilteredDiagrams: () => ClassificationDiagram[];
    getDiagramsByCategory: (category: string) => ClassificationDiagram[];
}

function loadCustomDiagrams(): ClassificationDiagram[] {
    try {
        const stored = localStorage.getItem('geochem-custom-diagrams');
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        return parsed?.state?.diagrams || [];
    } catch {
        return [];
    }
}

export const useClassificationStore = create<ClassificationState>((set, get) => {
    const builtInDiagrams = loadDiagrams();
    const customDiagrams = loadCustomDiagrams();
    const allDiagrams = [...builtInDiagrams, ...customDiagrams];
    const categories = [...new Set(allDiagrams.map(d => d.category))].sort();

    return {
        diagrams: allDiagrams,
        categories,

        selectedDiagramId: null,

        renderOptions: {
            style: 'color',
            showLabels: true,
            showGrid: true,
            showData: true,
            fillOpacity: 0.35
        },

        searchQuery: '',
        selectedCategory: null,

        setSelectedDiagram: (id) => set({ selectedDiagramId: id }),

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
            return {
                diagrams: newDiagrams,
                categories: newCategories,
                selectedDiagramId: state.selectedDiagramId === id ? null : state.selectedDiagramId,
            };
        }),

        refreshCustomDiagrams: () => {
            const builtIn = loadDiagrams();
            const custom = loadCustomDiagrams();
            const all = [...builtIn, ...custom];
            const cats = [...new Set(all.map(d => d.category))].sort();
            set({ diagrams: all, categories: cats });
        },

        getSelectedDiagram: () => {
            const { diagrams, selectedDiagramId } = get();
            return diagrams.find(d => d.id === selectedDiagramId) || null;
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

// Export diagram count for info
export const TOTAL_DIAGRAMS = (diagramData as any).totalDiagrams;
