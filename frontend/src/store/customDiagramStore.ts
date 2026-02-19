import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ClassificationDiagram } from '../types/classificationDiagram';

interface CustomDiagramLibrary {
    diagrams: ClassificationDiagram[];

    addDiagram: (diagram: ClassificationDiagram) => void;
    removeDiagram: (id: string) => void;
    updateDiagram: (diagram: ClassificationDiagram) => void;
    getDiagram: (id: string) => ClassificationDiagram | undefined;

    exportAll: () => string;
    importFromJson: (json: string) => number;
}

export const useCustomDiagramStore = create<CustomDiagramLibrary>()(
    persist(
        (set, get) => ({
            diagrams: [],

            addDiagram: (diagram) => set(state => ({
                diagrams: [...state.diagrams, diagram],
            })),

            removeDiagram: (id) => set(state => ({
                diagrams: state.diagrams.filter(d => d.id !== id),
            })),

            updateDiagram: (diagram) => set(state => ({
                diagrams: state.diagrams.map(d => d.id === diagram.id ? diagram : d),
            })),

            getDiagram: (id) => {
                return get().diagrams.find(d => d.id === id);
            },

            exportAll: () => {
                const { diagrams } = get();
                return JSON.stringify({ diagrams, totalDiagrams: diagrams.length }, null, 2);
            },

            importFromJson: (json) => {
                try {
                    const parsed = JSON.parse(json);
                    const imported: ClassificationDiagram[] = parsed.diagrams || [];
                    if (imported.length === 0) return 0;

                    // Ensure all imported diagrams have custom- prefix
                    const withIds = imported.map(d => ({
                        ...d,
                        id: d.id.startsWith('custom-') ? d.id : `custom-${d.id}`,
                    }));

                    set(state => {
                        const existingIds = new Set(state.diagrams.map(d => d.id));
                        const newDiagrams = withIds.filter(d => !existingIds.has(d.id));
                        return {
                            diagrams: [...state.diagrams, ...newDiagrams],
                        };
                    });

                    return withIds.length;
                } catch {
                    return 0;
                }
            },
        }),
        {
            name: 'geochem-custom-diagrams',
        }
    )
);
